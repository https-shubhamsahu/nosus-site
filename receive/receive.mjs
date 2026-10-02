import {makeKey,derive,Cipher,Transfer,randomId,encodeSignal,decodeSignal,validateSignal,LIMIT} from './protocol.mjs';
import {QRCode,jsQR,createBurnNote,createBurnFile,SUPABASE_URL,SUPABASE_ANON_KEY} from './vendor.mjs';
const $=id=>document.getElementById(id), show=(id,value)=>$(id).hidden=!value;
let pc,channel,key,offer,answer,cipher,transfer,secret,token,poll,expiry,qrTimer,scanStream,scanTimer,burnTimer,localUrl,connectionTimeout,busy=false,closed=false,sendQueue=Promise.resolve(),readQueue=Promise.resolve(),draftFiles=[];
let mode='online', qrFrames=new Map(), scanFrames=new Map();
const status=s=>{$('status').textContent=s;}, error=e=>{$('error').textContent=e.message||'Connection failed';};
const hex=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
function chooseSend(value=true){show('choices',!value);show('senderSetup',value);status(value?'Step 1 · Connect to the receiving device':'What would you like to do?');}
function contentTab(files=false){show('textDraft',!files);show('fileDraft',files);$('textTab').setAttribute('aria-pressed',String(!files));$('fileTab').setAttribute('aria-pressed',String(files));}
function connectionMode(){const offline=$('mode').value==='offline';show('offlineHelp',offline);$('joinLabel').firstChild.textContent=offline?'Full connection offer':'Connection code';$('joinText').placeholder=offline?'Scan the other device’s QR or paste its full offer':'8-character code';}
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
  c.onopen=()=>{clearTimeout(connectionTimeout);if(cipher)showConfirm();};c.onclose=()=>{if(!closed){status('Disconnected. Delivery may be uncertain if the final receipt was lost.');end();}};
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
  closed=false;key=await makeKey();secret=hex();sendQueue=Promise.resolve();readQueue=Promise.resolve();
  pc=new RTCPeerConnection({iceServers:mode==='offline'?[]:[{urls:'stun:stun.l.google.com:19302'}]});
  pc.ondatachannel=e=>bindChannel(e.channel);
  pc.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(pc.connectionState)&&!closed){error(Error('Connection ended. Check the Wi-Fi or hotspot and try again.'));end();}};
  if(role==='offer')bindChannel(pc.createDataChannel('burn',{ordered:true}));
}
async function secure(role) {
  const material=await derive({role,key:key.privateKey},offer,answer);if(closed)return;
  cipher=new Cipher(material,role==='offer'?0:1);transfer=new Transfer(wire,render);$('match').textContent=material.code;
  if(channel?.readyState==='open')showConfirm();
}
function showConfirm(){status('Step 2 · Check both screens');show('confirm',true);show('pairing',false);stopQR();show('end',true);}
async function displayQR(text,title) {
  stopQR();show('pairing',true);$('qrTitle').textContent=title;$('details').value=text.startsWith('NS1.')?`NS1.${text.slice(4).match(/.{1,8}/g).join(' ')}`:text;
  $('detailsLabel').firstChild.textContent=`Connection details — ${text.length} characters`;
  const response=mode==='offline'&&answer!=null;
  show('codeBlock',mode==='online'&&!!$('code').textContent);show('qr',!response);$('connectionDetails').open=response;
  $('detailsSummary').textContent=response?'Your response — enter this on the receiving device':'More connection options';
  $('qrHelp').textContent=response?'Enter the full response below on the receiving device. Keep both screens open.':'On the sending device, choose Send and scan this QR. Keep this screen open.';
  const id=randomId(),chunks=text.match(/.{1,800}/g)||[text];qrFrames=new Map(chunks.map((chunk,i)=>[i,chunks.length===1?text:`NF1.${id}.${i}.${chunks.length}.${chunk}`]));let index=0;
  const draw=async()=>{await QRCode.toCanvas($('qr'),qrFrames.get(index),{width:360,errorCorrectionLevel:'M',margin:3});$('frame').textContent=chunks.length>1?`QR part ${index+1} of ${chunks.length}. Keep the phone pointed at the screen.`:'';index=(index+1)%chunks.length;};
  await draw();if(chunks.length>1)qrTimer=setInterval(()=>draw().catch(error),1200);
}
function stopQR(){clearInterval(qrTimer);qrFrames.clear();}
async function startReceive(local=false) {
  mode=local?'offline':$('mode').value;await setup('offer');
  await pc.setLocalDescription(await pc.createOffer());await gather();offer={v:1,role:'offer',sid:randomId(),pub:key.pub,expires:Date.now()+15*60000,sdp:pc.localDescription.sdp};
  expiry=setTimeout(()=>{error(Error('Connection expired. Start a new session.'));end();},15*60000);
  show('setup',false);show('end',true);status('Waiting for the sending device…');
  if(local){
    const raw=$('localAddress').value.trim();if(!/^(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d{2,5}$/.test(raw))throw Error('Enter the private Wi-Fi address and port shown on the phone');
    localUrl=`http://${raw}`;const encoded=await encodeSignal(offer);await displayQR(`NL1.${raw}.${encoded}`,'Scan with the Android NO SUS app');
    await localRequest('offer',{offer});poll=setInterval(()=>localRequest('poll').then(r=>{if(r.answer&&!answer)acceptAnswer(r.answer).catch(error);}).catch(e=>{error(e);end();}),2000);
  }else if(mode==='online'){
    token=hex();const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const code=Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>alphabet[b%32]).join('');
    await signal('create',{offer,token,code});$('code').textContent=code;await displayQR(`https://nosus.foo/receive/#device=${token}`,'Ready to receive');
    poll=setInterval(()=>signal('poll').then(r=>{if(r.answer&&!answer)acceptAnswer(r.answer).catch(error);}).catch(e=>{error(e);end();}),2000);
  }else{await displayQR(await encodeSignal(offer),'Scan this QR on the phone');show('answerEntry',true);}
}
async function localRequest(action,extra={}) {
  const res=await fetch(`${localUrl}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid:offer.sid,...extra}),cache:'no-store',signal:AbortSignal.timeout(10000),targetAddressSpace:'local'});
  const data=await res.json();if(!res.ok)throw Error(data.error||'Local connection blocked');return data;
}
async function join(raw) {
  raw=raw.trim();mode=raw.startsWith('NS1.')?'offline':$('mode').value;
  if(mode==='offline'&&!raw.startsWith('NS1.'))throw Error('Scan or enter the complete offline offer from the PC');
  await setup('answer');
  if(mode==='offline')offer=await decodeSignal(raw,'offer');else{
    const found=raw.match(/(?:#device=|\/device\/)([a-f0-9]{64})/);const result=await signal('join',found?{token:found[1]}:{code:raw.toUpperCase().replace(/\s/g,'')});offer=validateSignal(result.offer,'offer');
  }
  show('setup',false);show('end',true);status('Connecting…');
  expiry=setTimeout(()=>{error(Error('Connection expired'));end();},offer.expires-Date.now());
  await pc.setRemoteDescription({type:'offer',sdp:offer.sdp});await pc.setLocalDescription(await pc.createAnswer());await gather();
  answer={v:1,role:'answer',sid:offer.sid,pub:key.pub,expires:offer.expires,sdp:pc.localDescription.sdp};await secure('answer');
  if(mode==='offline'){await displayQR(await encodeSignal(answer),'Type these response details on the PC');$('code').textContent='';}else await signal('answer',{answer});
}
async function acceptAnswer(value){if(answer)return;const next=typeof value==='string'?await decodeSignal(value,'answer'):validateSignal(value,'answer');if(next.sid!==offer.sid||next.expires!==offer.expires)throw Error('Response belongs to another session');answer=next;clearInterval(poll);await secure('offer');await pc.setRemoteDescription({type:'answer',sdp:answer.sdp});if(channel?.readyState!=='open')connectionTimeout=setTimeout(()=>{if(!closed&&channel?.readyState!=='open'){error(Error('Connection blocked. Check the Wi-Fi or hotspot and whether the network allows devices to communicate.'));status('Disconnected');end();}},30000);}
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
  const p=await transfer.consume(id);
  if(p.kind==='text'){
    burnText();$('secret').textContent=new TextDecoder().decode(p.bytes);p.bytes.fill(0);show('reveal',true);const deadline=Date.now()+60000;$('timer').textContent='Burns in 60 seconds';
    burnTimer=setInterval(()=>{const left=Math.max(0,Math.ceil((deadline-Date.now())/1000));$('timer').textContent=`Burns in ${left} seconds`;if(left<=0)burnText();},250);
  }else if(p.kind==='link'){const link=new TextDecoder().decode(p.bytes);p.bytes.fill(0);window.open(link,'_blank','noopener,noreferrer');}
  else{const url=URL.createObjectURL(new Blob([p.bytes]));p.bytes.fill(0);const a=document.createElement('a');a.href=url;a.download=p.name.replace(/[\\/\x00-\x1f]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
function burnText(){clearInterval(burnTimer);$('secret').textContent='';show('reveal',false);}
async function sendText(){const text=$('note').value;if(!text.trim())throw Error('Enter text first');if(mode==='online'){const r=await createBurnNote(text,false);await transfer.deliver('link','Burn text',new TextEncoder().encode(r.link));}else await transfer.deliver('text','Burn text',new TextEncoder().encode(text));$('note').value='';}
async function sendFiles(){const files=draftFiles.length?draftFiles:[...$('files').files];if(!files.length)throw Error('Choose files first');if(files.length>10||files.reduce((s,f)=>s+f.size,0)>LIMIT)throw Error('Choose up to 10 files, 25 MB combined');for(const f of files){if(mode==='online'){const r=await createBurnFile(f,24,()=>{},false);await transfer.deliver('link',f.name,new TextEncoder().encode(r.link));}else await transfer.deliver('file',f.name,new Uint8Array(await f.arrayBuffer()));}draftFiles=[];$('files').value='';$('draftFiles').textContent='';}
function stopScan(){clearTimeout(scanTimer);scanStream?.getTracks().forEach(t=>t.stop());scanStream=null;show('camera',false);}
async function scanValue(text){
  if(text.startsWith('NF1.')){const match=/^NF1\.([A-Za-z0-9_-]{22})\.(\d+)\.(\d+)\.(.+)$/.exec(text);if(!match)return;
    const [,id,i,count,data]=match,n=Number(count),index=Number(i);if(n>50||n<1||index>=n)return;
    if(!scanFrames.has(id)){scanFrames.clear();scanFrames.set(id,new Map());}const frames=scanFrames.get(id);frames.set(index,data);$('scanProgress').textContent=`Read ${frames.size} of ${n} QR parts`;
    if(frames.size!==n)return;text=Array.from({length:n},(_,at)=>frames.get(at)).join('');scanFrames.clear();
  }
  if(!text.startsWith('NS1.')&&!/#device=[a-f0-9]{64}/.test(text))return;stopScan();$('joinText').value=text;await join(text);
}
async function startScan(){scanFrames.clear();scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});$('video').srcObject=scanStream;await $('video').play();show('camera',true);const canvas=document.createElement('canvas');const loop=async()=>{if(!scanStream)return;const v=$('video');if(v.videoWidth){canvas.width=v.videoWidth;canvas.height=v.videoHeight;const ctx=canvas.getContext('2d');ctx.drawImage(v,0,0);const frame=ctx.getImageData(0,0,canvas.width,canvas.height);const qr=jsQR(frame.data,frame.width,frame.height);if(qr)await scanValue(qr.data);}scanTimer=setTimeout(()=>loop().catch(e=>{stopScan();error(e);}),250);};await loop();}
function end(){closed=true;clearInterval(poll);clearTimeout(expiry);clearTimeout(connectionTimeout);stopQR();stopScan();burnText();transfer?.clear();cipher?.clear();pc?.close();cipher=transfer=pc=channel=key=offer=answer=null;draftFiles=[];$('draftFiles').textContent='';$('note').value='';$('files').value='';$('details').value='';$('answer').value='';$('joinText').value='';$('inbox').replaceChildren();$('confirmButton').disabled=false;for(const id of ['pairing','confirm','sendSection','end','answerEntry'])show(id,false);show('setup',true);}
async function run(action){if(busy)return;busy=true;$('error').textContent='';try{await action();}catch(e){error(e);if(!transfer?.connected){const note=$('note').value,files=[...draftFiles];end();$('note').value=note;draftFiles=files;$('draftFiles').textContent=files.map(f=>f.name).join(' · ');status('Could not connect. Your draft is safe — try again.');}}finally{busy=false;}}
async function checkOffline(registration){await new Promise((resolve,reject)=>{const c=new MessageChannel();const timer=setTimeout(()=>reject(Error('Could not verify the offline page')),15000);c.port1.onmessage=e=>{clearTimeout(timer);if(e.data){resolve();}else{reject(Error('Offline files are incomplete'));}};(registration.active||registration.waiting)?.postMessage('check-ready',[c.port2]);});$('offlineStatus').textContent='Ready for offline sharing. Keep this saved page on both browser devices.';}
async function saveOffline(){if(!('serviceWorker' in navigator))throw Error('Offline caching is unavailable in this browser');const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./'});await navigator.serviceWorker.ready;await checkOffline(registration);}
if('serviceWorker' in navigator)navigator.serviceWorker.getRegistration('./').then(r=>{if(r?.active)return checkOffline(r);}).catch(()=>{});
function enable(){try{localStorage.setItem('burn_device_sharing_enabled','true');}catch{}show('preview',false);show('app',true);if(location.hash.startsWith('#device=')){const raw=location.href;history.replaceState(null,'',location.pathname);run(()=>join(raw));}else if(location.hash==='#send'){history.replaceState(null,'',location.pathname);chooseSend();}window.parent.postMessage({type:'burn-device-ready'},location.origin);}
$('enable').onclick=enable;try{if(localStorage.getItem('burn_device_sharing_enabled')!=='false')enable();}catch{enable();}
$('save').onclick=()=>run(saveOffline);$('receive').onclick=()=>run(()=>startReceive());$('localConnect').onclick=()=>run(()=>startReceive(true));$('join').onclick=()=>run(()=>join($('joinText').value));$('accept').onclick=()=>run(()=>acceptAnswer($('answer').value));$('scan').onclick=()=>run(startScan);$('stopScan').onclick=stopScan;
$('confirmButton').onclick=()=>run(async()=>{await transfer.confirm();$('confirmButton').disabled=true;$('confirmationHelp').textContent='Waiting for confirmation on the other device…';});$('sendNote').onclick=()=>run(sendText);$('sendFiles').onclick=()=>run(sendFiles);
$('chooseSend').onclick=()=>chooseSend();$('back').onclick=()=>chooseSend(false);$('mode').onchange=connectionMode;$('textTab').onclick=()=>contentTab();$('fileTab').onclick=()=>contentTab(true);
$('end').onclick=()=>{if(mode==='online'&&offer)signal('end').catch(()=>{});end();$('confirmButton').disabled=false;$('confirmationHelp').textContent='Confirm on both devices to connect.';chooseSend(false);status('Disconnected. Pending items cleared.');};$('burnNow').onclick=burnText;
$('copyDetails').onclick=()=>run(()=>navigator.clipboard.writeText($('details').value));$('copySecret').onclick=()=>run(()=>navigator.clipboard.writeText($('secret').textContent));
$('qrImage').onchange=()=>run(async()=>{const file=$('qrImage').files[0];if(!file)return;const image=await createImageBitmap(file);const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const frame=ctx.getImageData(0,0,c.width,c.height);const qr=jsQR(frame.data,frame.width,frame.height);image.close();if(!qr)throw Error('No QR found in that image');await scanValue(qr.data);});
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent||e.data?.type!=='burn-device-draft')return;const d=e.data;if(typeof d.note==='string')$('note').value=d.note.slice(0,50000);if(Array.isArray(d.files)&&d.files.every(f=>f instanceof File)){draftFiles=d.files;$('draftFiles').textContent=draftFiles.map(f=>f.name).join(' · ');if(draftFiles.length)contentTab(true);}});
window.addEventListener('pagehide',end);document.addEventListener('visibilitychange',()=>{if(document.hidden)burnText();});

$('files').onchange=()=>{draftFiles=[...$('files').files];$('draftFiles').textContent=draftFiles.map(f=>`${f.name} — ${f.size} bytes`).join(' · ');};
