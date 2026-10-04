import {makeKey,derive,Cipher,Transfer,randomId,validateSignal,LIMIT} from './protocol.mjs';
import {QRCode,jsQR,createBurnNote,createBurnFile,SUPABASE_URL,SUPABASE_ANON_KEY} from './vendor.mjs';
const $=id=>document.getElementById(id), show=(id,value)=>$(id).hidden=!value;
const phone=navigator.userAgentData?.mobile===true || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
document.documentElement.dataset.device=phone?'phone':'computer';
show('scan',phone);show('desktopScan',!phone);
if(!phone)$('joinHelp').textContent='Enter the code or paste the connection link shown on the receiving device. No camera needed.';
let pc,channel,key,offer,answer,cipher,transfer,secret,token,poll,expiry,qrTimer,scanStream,scanTimer,burnTimer,connectionTimeout,busy=false,closed=false,sendQueue=Promise.resolve(),readQueue=Promise.resolve(),draftFiles=[];
let clockOffset=0;
const connectionNow=()=>Date.now()+clockOffset;
let qrFrames=new Map(), scanFrames=new Map();
const status=s=>{$('status').textContent=s;}, error=e=>{$('error').textContent=e.message||'Connection failed';};
const hex=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
function chooseSend(value=true){show('choices',!value);show('senderSetup',value);status(value?'Step 1 · Connect to the receiving device':'What would you like to do?');}
function contentTab(files=false){show('textDraft',!files);show('fileDraft',files);$('textTab').setAttribute('aria-pressed',String(!files));$('fileTab').setAttribute('aria-pressed',String(files));}
async function signal(action,extra={}) {
  const res=await fetch(`${SUPABASE_URL}/functions/v1/burn-device-signal`,{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({action,secret,sid:offer?.sid,...extra}),signal:AbortSignal.timeout(15000),cache:'no-store'});
  const data=await res.json();if(!res.ok)throw Error(data.error||'Connection service unavailable');return data;
}
async function gather() {
  if(pc.iceGatheringState==='complete')return;
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',change);if(pc.localDescription?.sdp?.includes('a=candidate:'))resolve();else reject(Error('Could not gather local connection details'));},15000);const change=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timeout);pc.removeEventListener('icegatheringstatechange',change);resolve();}};pc.addEventListener('icegatheringstatechange',change);});
}
function bindChannel(c) {
  channel=c;c.bufferedAmountLowThreshold=65536;
  c.onmessage=event=>{readQueue=readQueue.then(async()=>{if(!cipher)throw Error('Connection not authenticated');if(typeof event.data!=='string'||event.data.length>42000)throw Error('Invalid connection message');await transfer.receive(await cipher.open(JSON.parse(event.data)));}).catch(e=>{error(e);end();});};
  c.onopen=()=>{clearTimeout(connectionTimeout);if(cipher)showConfirm();};c.onclose=()=>{if(!closed){status('Disconnected. Your unsent draft is safe. Delivery may be uncertain if the final receipt was lost.');end(true);show('retry',true);}};
}
async function wire(value) {
  sendQueue=sendQueue.then(async()=>{
    if(closed||!cipher||channel?.readyState!=='open')throw Error('Device disconnected');
    const deadline=Date.now()+15000;
    while(channel.bufferedAmount>262144){if(channel.readyState!=='open'||Date.now()>deadline)throw Error('Transfer interrupted');await new Promise(r=>setTimeout(r,20));}
    channel.send(JSON.stringify(await cipher.box(value)));
  });return sendQueue;
}
async function setup(role) {
  if(pc)throw Error('End the current connection before pairing again.');
  show('retry',false);
  closed=false;key=await makeKey();secret=hex();sendQueue=Promise.resolve();readQueue=Promise.resolve();
  const started=Date.now(),time=await signal('clock');
  if(!Number.isSafeInteger(time.now))throw Error('Connection service unavailable. Try again.');
  clockOffset=time.now-Math.round((started+Date.now())/2);
  pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
  pc.ondatachannel=e=>bindChannel(e.channel);
  const peer=pc;pc.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(peer.connectionState)&&!closed){error(Error('Connection ended. Check the Wi-Fi or hotspot and try again.'));end(true);show('retry',true);}};
  if(role==='offer')bindChannel(pc.createDataChannel('burn',{ordered:true}));
}
async function secure(role) {
  const material=await derive({role,key:key.privateKey},offer,answer,connectionNow());if(closed)return;
  cipher=new Cipher(material,role==='offer'?0:1);transfer=new Transfer(wire,render);$('match').textContent=material.code;
  if(channel?.readyState==='open')showConfirm();
}
function showConfirm(){status('Step 2 · Check both screens');show('confirm',true);show('pairing',false);stopQR();show('end',true);}
async function displayQR(text,title) {
  stopQR();show('pairing',true);$('qrTitle').textContent=title;$('details').value=text.startsWith('NS1.')?`NS1.${text.slice(4).match(/.{1,8}/g).join(' ')}`:text;
  $('detailsLabel').firstChild.textContent=`Connection details — ${text.length} characters`;
  show('codeBlock',!!$('code').textContent);show('qr',true);$('connectionDetails').open=false;
  $('detailsSummary').textContent='More connection options';
  $('qrHelp').textContent='On the sending phone, choose Send and scan this QR. On a computer, enter the code or paste the connection link. Keep this screen open.';
  const id=randomId(),chunks=text.match(/.{1,800}/g)||[text];qrFrames=new Map(chunks.map((chunk,i)=>[i,chunks.length===1?text:`NF1.${id}.${i}.${chunks.length}.${chunk}`]));let index=0;
  const draw=async()=>{await QRCode.toCanvas($('qr'),qrFrames.get(index),{width:360,errorCorrectionLevel:'M',margin:3});$('frame').textContent=chunks.length>1?`QR part ${index+1} of ${chunks.length}. Keep the phone pointed at the screen.`:'';index=(index+1)%chunks.length;};
  await draw();if(chunks.length>1)qrTimer=setInterval(()=>draw().catch(error),1200);
}
function stopQR(){clearInterval(qrTimer);qrFrames.clear();}
async function startReceive() {
  if(!navigator.onLine)throw Error('Internet is required on the website. Offline sharing is available only between Android apps.');
  status('Preparing your connection… Keep this screen open.');
  await setup('offer');await pc.setLocalDescription(await pc.createOffer());await gather();offer={v:1,role:'offer',sid:randomId(),pub:key.pub,expires:connectionNow()+15*60000,sdp:pc.localDescription.sdp};
  expiry=setTimeout(()=>{error(Error('Connection expired. Start a new session.'));end();},15*60000);
  show('setup',false);show('end',true);status('Waiting for the sending device…');
    token=hex();const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const code=Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>alphabet[b%32]).join('');
    await signal('create',{offer,token,code});$('code').textContent=code;await displayQR(`https://nosus.foo/receive/#device=${token}`,'Ready to receive');
    poll=setInterval(()=>signal('poll').then(r=>{if(r.answer&&!answer)acceptAnswer(r.answer).catch(error);}).catch(e=>{error(e);end();}),2000);

}
async function join(raw) {
  raw=raw.trim();
  if(/^(NS1|NL1|NF1)\./.test(raw))throw Error('Offline sharing is available only between Android apps. Use the receiving device’s online QR or 8-character code.');
  if(!navigator.onLine)throw Error('Internet is required on the website.');
  await setup('answer');
  const found=raw.match(/(?:#device=|\/device\/)([a-f0-9]{64})/);const result=await signal('join',found?{token:found[1]}:{code:raw.toUpperCase().replace(/\s/g,'')});offer=validateSignal(result.offer,'offer',connectionNow());
  show('setup',false);show('end',true);status('Connecting…');
  expiry=setTimeout(()=>{error(Error('Connection expired'));end();},offer.expires-connectionNow());
  await pc.setRemoteDescription({type:'offer',sdp:offer.sdp});await pc.setLocalDescription(await pc.createAnswer());await gather();
  answer={v:1,role:'answer',sid:offer.sid,pub:key.pub,expires:offer.expires,sdp:pc.localDescription.sdp};await secure('answer');
  await signal('answer',{answer});
  waitForConnection();
}
async function acceptAnswer(value){if(answer)return;const next=validateSignal(value,'answer',connectionNow());if(next.sid!==offer.sid||next.expires!==offer.expires)throw Error('Response belongs to another session');answer=next;clearInterval(poll);await secure('offer');await pc.setRemoteDescription({type:'answer',sdp:answer.sdp});waitForConnection();}
function waitForConnection(){clearTimeout(connectionTimeout);if(channel?.readyState!=='open')connectionTimeout=setTimeout(()=>{if(!closed&&channel?.readyState!=='open'){error(Error('Connection blocked. Put both devices on the same Wi-Fi or hotspot, or share a Burn link instead.'));status('Disconnected — your unsent draft is safe');end(true);show('retry',true);}},30000);}
function render(){
  if(!transfer)return;if(transfer.connected){show('confirm',false);show('sendSection',true);status('Connected · You can now send in either direction');}
  show('progress',transfer.progress>0&&transfer.progress<1);
  $('progress').value=transfer.progress;$('sent').textContent=[...transfer.outgoing.values()].map(p=>`${p.name}: ${p.state}`).join(' · ');
  $('inbox').replaceChildren();show('inboxTitle',transfer.pending.size>0);show('inboxSection',transfer.pending.size>0);
  for(const p of transfer.pending.values()){
    const row=document.createElement('div');row.className='item';const label=document.createElement('p');label.textContent=`${p.name}: ${p.state==='sending'?`${Math.round(p.received/p.size*100)}%`:p.state}`;row.append(label);
    if(p.state==='ready'){const button=document.createElement('button');button.textContent=p.kind==='text'?'Reveal':p.kind==='link'?'Open Burn':'Download';button.onclick=()=>consume(p.id).catch(error);row.append(button);} $('inbox').append(row);
  }
  if(transfer.receiptUncertain)$('receipt').textContent='Content consumed here; sender receipt could not be confirmed.';
}
async function consume(id){
  // Reserve the tab during the click, before awaiting the one-time receipt.
  const tab=transfer.pending.get(id)?.kind==='link'?window.open('about:blank','_blank'):null;
  if(tab)tab.opener=null;
  let p;try{p=await transfer.consume(id);}catch(e){tab?.close();throw e;}
  if(p.kind==='text'){
    burnText();$('secret').textContent=new TextDecoder().decode(p.bytes);p.bytes.fill(0);show('reveal',true);const deadline=Date.now()+60000;$('timer').textContent='Burns in 60 seconds';
    burnTimer=setInterval(()=>{const left=Math.max(0,Math.ceil((deadline-Date.now())/1000));$('timer').textContent=`Burns in ${left} seconds`;if(left<=0)burnText();},250);
  }else if(p.kind==='link'){const link=new TextDecoder().decode(p.bytes);p.bytes.fill(0);if(tab)tab.location.replace(link);else location.assign(link);}
  else{const url=URL.createObjectURL(new Blob([p.bytes]));p.bytes.fill(0);const a=document.createElement('a');a.href=url;a.download=p.name.replace(/[\\/\x00-\x1f]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
function burnText(){clearInterval(burnTimer);$('secret').textContent='';show('reveal',false);}
async function sendText(){const text=$('note').value;if(!text.trim())throw Error('Enter text first');const r=await createBurnNote(text,false);await transfer.deliver('link','Burn text',new TextEncoder().encode(r.link));$('note').value='';}
async function sendFiles(){const files=draftFiles.length?[...draftFiles]:[...$('files').files];if(!files.length)throw Error('Choose files first');if(files.length>10||files.reduce((s,f)=>s+f.size,0)>LIMIT)throw Error('Choose up to 10 files, 25 MB combined');draftFiles=[...files];$('files').value='';for(const f of files){const r=await createBurnFile(f,24,()=>{},false);await transfer.deliver('link',f.name,new TextEncoder().encode(r.link));draftFiles.shift();$('draftFiles').textContent=draftFiles.map(f=>f.name).join(' · ');}}
function stopScan(){clearTimeout(scanTimer);scanStream?.getTracks().forEach(t=>t.stop());scanStream=null;show('camera',false);}
async function scanValue(text){
  if(/^(NS1|NL1|NF1)\./.test(text))throw Error('Offline sharing is available only between Android apps.');
  if(!/#device=[a-f0-9]{64}/.test(text))throw Error('Scan the receiving device’s online QR.');stopScan();$('joinText').value=text;await join(text);
}
async function startScan(){scanFrames.clear();scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});$('video').srcObject=scanStream;await $('video').play();show('camera',true);const canvas=document.createElement('canvas');const loop=async()=>{if(!scanStream)return;const v=$('video');if(v.videoWidth){canvas.width=v.videoWidth;canvas.height=v.videoHeight;const ctx=canvas.getContext('2d');ctx.drawImage(v,0,0);const frame=ctx.getImageData(0,0,canvas.width,canvas.height);const qr=jsQR(frame.data,frame.width,frame.height);if(qr)await scanValue(qr.data);}scanTimer=setTimeout(()=>loop().catch(e=>{stopScan();error(e);}),250);};await loop();}
function end(keepDraft=false){closed=true;clearInterval(poll);clearTimeout(expiry);clearTimeout(connectionTimeout);stopQR();stopScan();burnText();transfer?.clear();cipher?.clear();pc?.close();cipher=transfer=pc=channel=key=offer=answer=null;if(!keepDraft){draftFiles=[];$('draftFiles').textContent='';$('note').value='';$('files').value='';}$('details').value='';$('joinText').value='';$('inbox').replaceChildren();$('sent').textContent='';$('receipt').textContent='';$('code').textContent='';$('confirmButton').disabled=false;$('confirmationHelp').textContent='Confirm on both devices to connect.';for(const id of ['pairing','confirm','sendSection','end','inboxSection','progress','retry'])show(id,false);show('setup',true);}
async function run(action){if(busy)return;busy=true;const buttons=['chooseSend','receive','join','scan','desktopScan','confirmButton','sendNote','sendFiles','back'];for(const id of buttons)$(id).disabled=true;$('app').setAttribute('aria-busy','true');$('error').textContent='';try{await action();}catch(e){error(e);if(!transfer?.connected){end(true);status('Could not connect. Your draft is safe — try again.');show('retry',true);}}finally{busy=false;for(const id of buttons)$(id).disabled=false;$('confirmButton').disabled=transfer?.localConfirmed??false;$('app').setAttribute('aria-busy','false');}}
function enable(){try{localStorage.setItem('burn_device_sharing_enabled','true');}catch{}show('preview',false);show('app',true);if(location.hash.startsWith('#device=')){const raw=location.href;history.replaceState(null,'',location.pathname);run(()=>join(raw));}else if(location.hash==='#send'){history.replaceState(null,'',location.pathname);chooseSend();}window.parent.postMessage({type:'burn-device-ready'},location.origin);}
$('enable').onclick=enable;try{if(localStorage.getItem('burn_device_sharing_enabled')!=='false')enable();}catch{enable();}
$('receive').onclick=()=>run(()=>startReceive());$('join').onclick=()=>run(()=>join($('joinText').value));$('scan').onclick=$('desktopScan').onclick=()=>run(startScan);$('stopScan').onclick=stopScan;
$('confirmButton').onclick=()=>run(async()=>{await transfer.confirm();$('confirmButton').disabled=true;$('confirmationHelp').textContent='Waiting for confirmation on the other device…';});$('sendNote').onclick=()=>run(sendText);$('sendFiles').onclick=()=>run(sendFiles);
$('chooseSend').onclick=()=>chooseSend();$('back').onclick=()=>chooseSend(false);$('textTab').onclick=()=>contentTab();$('fileTab').onclick=()=>contentTab(true);
$('end').onclick=()=>{if(offer)signal('end').catch(()=>{});end();$('confirmButton').disabled=false;$('confirmationHelp').textContent='Confirm on both devices to connect.';chooseSend(false);status('Disconnected. Pending items cleared.');};$('burnNow').onclick=burnText;
async function copy(value){try{await navigator.clipboard.writeText(value);status('Copied. Paste it on the sending device.');}catch{$('connectionDetails').open=true;$('details').focus();$('details').select();error(Error('Clipboard unavailable. Select and copy the connection link below.'));}}
$('copyCode').onclick=()=>copy($('code').textContent);$('copyLink').onclick=()=>copy($('details').value);
$('retry').onclick=()=>{end(true);chooseSend(false);status('Your draft is safe. Choose Send or Receive to reconnect.');};
$('copyDetails').onclick=()=>run(()=>navigator.clipboard.writeText($('details').value));$('copySecret').onclick=()=>run(()=>navigator.clipboard.writeText($('secret').textContent));
$('qrImage').onchange=()=>run(async()=>{const file=$('qrImage').files[0];if(!file)return;const image=await createImageBitmap(file);const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const frame=ctx.getImageData(0,0,c.width,c.height);const qr=jsQR(frame.data,frame.width,frame.height);image.close();if(!qr)throw Error('No QR found in that image');await scanValue(qr.data);});
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent)return;if(e.data?.type==='burn-device-init'){if(!$('app').hidden)window.parent.postMessage({type:'burn-device-ready'},location.origin);return;}if(e.data?.type!=='burn-device-draft')return;const d=e.data;if(typeof d.note==='string')$('note').value=d.note.slice(0,50000);if(Array.isArray(d.files)&&d.files.every(f=>f instanceof File)){draftFiles=d.files;$('draftFiles').textContent=draftFiles.map(f=>f.name).join(' · ');if(draftFiles.length)contentTab(true);}});
window.addEventListener('pagehide',()=>end());document.addEventListener('visibilitychange',()=>{if(document.hidden)burnText();});

$('files').onchange=()=>{draftFiles=[...$('files').files];$('draftFiles').textContent=draftFiles.map(f=>`${f.name} — ${f.size} bytes`).join(' · ');};
