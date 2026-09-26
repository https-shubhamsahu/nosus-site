(() => {
  if (!window.gsap) return;

  const E = {
    out: "expo.out",
    in: "power2.in",
    inout: "power3.inOut",
    soft: "power2.out",
    snap: "power4.out",
  };

  const REDUCE = /(?:^|[?&])reduce=1(?:&|$)/.test(location.search);
  const scenes = [...document.querySelectorAll(".scene")];
  const motif = document.querySelector("#motif");
  const curtain = document.querySelector("#curtain");
  const counter = document.querySelector("#counter");
  const fill = document.querySelector("#progressFill");
  const controls = document.querySelector(".controls");

  let index = 0;
  let tl = null;
  let touchX = 0;
  let hideT = 0;
  let pointerT = 0;
  const REMOTE_SYNC = location.protocol === "http:" || location.protocol === "https:";
  let remoteRevision = 0;

  function syncHostState() {
    if (!REMOTE_SYNC) return;
    fetch("/api/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ index, source: "host" }),
      cache: "no-store",
    }).catch(() => {});
  }

  async function pollRemoteState() {
    if (!REMOTE_SYNC) return;
    try {
      const response = await fetch(`/api/state?since=${remoteRevision}`, { cache: "no-store" });
      if (!response.ok) return;
      const state = await response.json();
      remoteRevision = Math.max(remoteRevision, Number(state.revision) || 0);
      if (state.source === "remote" && Number.isInteger(state.index) && state.index !== index) {
        go(state.index, { fromRemote: true });
      }
    } catch (_) {
      // The deck remains fully usable when the optional Wi-Fi controller is offline.
    }
  }

  const q = (scene, sel) => scene.querySelector(sel);
  const qa = (scene, sel) => [...scene.querySelectorAll(sel)];

  function dip(to = 1, d = 0.22) {
    return gsap.to(curtain, { opacity: to, duration: d, ease: "none" });
  }

  function slotRect(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, s: Math.max(r.width / 8, 0.7) };
  }

  function motifTo(target, vars = {}) {
    const el = typeof target === "string" ? document.querySelector(target) : target;
    const pt = el && el.nodeType ? slotRect(el) : target;
    if (!pt || pt.x == null) return gsap.to(motif, { autoAlpha: 0, duration: 0.2, ...vars });
    return gsap.to(motif, {
      left: pt.x,
      top: pt.y,
      scale: pt.s,
      duration: vars.duration ?? 0.7,
      ease: vars.ease ?? E.out,
      backgroundColor: vars.color ?? "#8a8a8a",
      autoAlpha: vars.autoAlpha ?? 1,
      overwrite: "auto",
    });
  }

  function resetMotif(x = innerWidth / 2, y = innerHeight / 2, scale = 0, color = "#fff") {
    gsap.set(motif, { left: x, top: y, scale, backgroundColor: color, autoAlpha: 1 });
  }

  function buildHook(scene) {
    const t = gsap.timeline();
    const lines = qa(scene, ".hook-type .mask > span");
    const mark = q(scene, ".wordmark");
    gsap.set(lines, { yPercent: 110 });
    gsap.set(mark, { autoAlpha: 0, y: 10 });
    resetMotif(innerWidth * 0.5, innerHeight * 0.5, 0, "#fff");

    t.to(motif, { scale: 1, duration: 0.38, ease: E.out }, 0.18)
      .to({}, { duration: 0.28 })
      .to(lines[0], { yPercent: 0, duration: 0.7, ease: E.out }, ">-0.02")
      .to(lines[1], { yPercent: 0, duration: 0.7, ease: E.out }, ">-0.42")
      .to(lines[2], { yPercent: 0, duration: 0.82, ease: E.out }, ">-0.4")
      .to({}, { duration: 0.7 })
      .add(() => motifTo(q(scene, ".slot"), { duration: 0.9, color: "#8a8a8a" }))
      .to(mark, { autoAlpha: 1, y: 0, duration: 0.7, ease: E.out }, "<0.15");
    return t;
  }

  function buildSend(scene) {
    const t = gsap.timeline();
    const doc = q(scene, ".doc");
    const cta = q(scene, ".send-cta");
    const voidMark = q(scene, ".void-mark");
    const lines = qa(scene, ".send-copy .mask > span");
    gsap.set(lines, { yPercent: 110 });
    gsap.set(doc, { x: 0, y: 0, scale: 1, autoAlpha: 1, rotate: 0 });
    gsap.set(cta, { autoAlpha: 1, scale: 1, color: "#f3f3f0" });
    gsap.set(voidMark, { autoAlpha: 0, scale: 0.92 });
    resetMotif(innerWidth * 0.72, innerHeight * 0.58, 0.6, "#8a8a8a");

    t.from(doc, { y: 36, autoAlpha: 0, duration: 0.55, ease: E.out }, 0.08)
      .from(cta, { x: 24, autoAlpha: 0, duration: 0.5, ease: E.out }, 0.18)
      .to(motif, { scale: 1.4, duration: 0.18, ease: E.in }, 0.72)
      .to(cta, { scale: 0.94, duration: 0.12, ease: E.in }, 0.78)
      .to(doc, { x: -18, duration: 0.16, ease: E.in }, 0.78)
      .to(cta, { scale: 1, duration: 0.22, ease: E.out }, 0.92)
      .to(
        doc,
        { x: innerWidth * 0.42, y: -20, scale: 0.18, autoAlpha: 0, rotate: 4, duration: 0.7, ease: "power3.in" },
        0.9
      )
      .to(motif, { left: innerWidth * 0.78, top: innerHeight * 0.54, scale: 0.5, duration: 0.55, ease: "power3.in" }, 0.9)
      .to(cta, { autoAlpha: 0.12, color: "#555", duration: 0.45, ease: E.soft }, 1.15)
      .to({}, { duration: 0.42 })
      .to(lines[0], { yPercent: 0, duration: 0.7, ease: E.out })
      .to({}, { duration: 0.38 })
      .to(lines[1], { yPercent: 0, duration: 0.75, ease: E.out })
      .to(voidMark, { autoAlpha: 1, scale: 1, duration: 0.9, ease: E.out }, "<0.15")
      .to(motif, { autoAlpha: 0.35, scale: 0.7, duration: 0.6, ease: E.soft }, "<");
    return t;
  }

  function buildQuestions(scene) {
    const t = gsap.timeline();
    const items = qa(scene, ".q-item");
    items.forEach((item, i) => {
      const span = item.querySelector("span");
      gsap.set(span, { yPercent: 110 });
      gsap.set(item, { autoAlpha: i ? 0 : 1 });
    });
    resetMotif(innerWidth * 0.14, innerHeight * 0.34, 0, "#8a8a8a");

    items.forEach((item, i) => {
      const span = item.querySelector("span");
      const last = i === items.length - 1;
      const at = i === 0 ? 0.12 : ">";
      t.set(item, { autoAlpha: 1 }, at)
        .to(span, { yPercent: 0, duration: 0.42, ease: E.snap }, at)
        .to(motif, { scale: 1, autoAlpha: 1, duration: 0.25, ease: E.out }, "<0.08");
      if (!last) {
        t.to(span, { yPercent: -110, duration: 0.28, ease: E.in }, "+=0.28")
          .set(item, { autoAlpha: 0 })
          .to(motif, { scale: 0.2, duration: 0.18, ease: E.in }, "<");
      }
    });
    t.to({}, { duration: 0.55 });
    return t;
  }

  function buildStorage(scene) {
    const t = gsap.timeline();
    const lead = qa(scene, ".storage-lead .mask > span");
    const words = qa(scene, ".storage-row span");
    const rules = qa(scene, ".storage-row i");
    const turn = q(scene, ".storage-turn span");
    gsap.set(lead, { yPercent: 110 });
    gsap.set(words, { autoAlpha: 0, y: 16 });
    gsap.set(rules, { scaleX: 0 });
    gsap.set(turn, { yPercent: 110 });
    resetMotif(innerWidth * 0.5, innerHeight * 0.54, 0, "#8a8a8a");

    t.to(lead, { yPercent: 0, duration: 0.72, ease: E.out, stagger: 0.12 }, 0.12)
      .to(words[0], { autoAlpha: 1, y: 0, duration: 0.4, ease: E.out }, 0.85)
      .to(rules[0], { scaleX: 1, duration: 0.35, ease: E.out }, 1.05)
      .to(words[1], { autoAlpha: 1, y: 0, duration: 0.4, ease: E.out }, 1.2)
      .to(rules[1], { scaleX: 1, duration: 0.35, ease: E.out }, 1.4)
      .to(words[2], { autoAlpha: 1, y: 0, duration: 0.4, ease: E.out }, 1.55)
      .to(rules[2], { scaleX: 1, duration: 0.4, ease: E.out }, 1.75)
      .to(motif, { left: innerWidth * 0.86, top: innerHeight * 0.54, scale: 1, duration: 0.55, ease: E.out }, 1.75)
      .to(turn, { yPercent: 0, duration: 0.7, ease: E.out }, 2.15);
    return t;
  }

  function buildReveal(scene) {
    const t = gsap.timeline();
    const mark = q(scene, ".reveal-mark");
    const kicker = q(scene, ".layer-kicker");
    const pair = qa(scene, ".layer-pair > *");
    gsap.set(mark, { autoAlpha: 0, y: 18 });
    gsap.set(kicker, { autoAlpha: 0, y: 10 });
    gsap.set(pair, { autoAlpha: 0, y: 18 });
    resetMotif(innerWidth * 0.5, innerHeight * 0.42, 0, "#8a8a8a");

    t.to(motif, { scale: 1, duration: 0.55, ease: E.out }, 0.2)
      .to(mark, { autoAlpha: 1, y: 0, duration: 1.05, ease: E.out }, 0.45)
      .add(() => motifTo(q(scene, ".slot"), { duration: 0.8 }), 0.55)
      .to({}, { duration: 0.35 })
      .to(kicker, { autoAlpha: 1, y: 0, duration: 0.45, ease: E.out })
      .to(pair, { autoAlpha: 1, y: 0, duration: 0.55, ease: E.out, stagger: 0.12 }, ">-0.1");
    return t;
  }

  function showShot(scene, name) {
    qa(scene, ".shot").forEach((img) => {
      gsap.to(img, { opacity: img.dataset.shot === name ? 1 : 0, duration: 0.45, ease: E.inout });
    });
  }

  function buildProduct(scene) {
    const t = gsap.timeline();
    const device = q(scene, ".device");
    const step = q(scene, "#product-step");
    const note = q(scene, "#product-note");
    const link = q(scene, ".tracked-link");
    const ident = q(scene, ".identity");
    const viewed = q(scene, ".viewed-event");
    const doc = q(scene, ".mini-doc");
    const shots = qa(scene, ".shot");

    gsap.set([step, note], { autoAlpha: 0, y: 12 });
    gsap.set(device, { y: 80, autoAlpha: 0, scale: 0.96 });
    const reset = { autoAlpha: 0, y: 16 };
    gsap.set(link, reset);
    gsap.set(ident, reset);
    gsap.set(viewed, reset);
    gsap.set(doc, { autoAlpha: 0, x: -40, y: 0, scale: 1 });
    gsap.set(shots, { opacity: 0 });
    gsap.set(q(scene, '[data-shot="workspace"]'), { opacity: 1 });
    resetMotif(innerWidth * 0.22, innerHeight * 0.22, 0, "#8a8a8a");

    const setCopy = (label, text) => {
      step.textContent = label;
      note.textContent = text;
    };

    t.to(device, { y: 0, autoAlpha: 1, scale: 1, duration: 0.85, ease: E.out }, 0.1)
      .add(() => setCopy("UPLOAD", "A document enters the workspace."))
      .to([step, note], { autoAlpha: 1, y: 0, duration: 0.4, ease: E.out }, 0.28)
      .to(doc, { autoAlpha: 1, x: 0, duration: 0.45, ease: E.out }, 0.45)
      .to(doc, { x: innerWidth * 0.28, y: -40, scale: 0.4, autoAlpha: 0, duration: 0.7, ease: "power3.in" }, 0.95)
      .add(() => setCopy("CREATE TRACKED LINK", "A share that still reports home."))
      .add(() => showShot(scene, "spyglass"), 1.45)
      .fromTo(step, { y: 10 }, { y: 0, duration: 0.35, ease: E.out }, 1.45)
      .to(link, { autoAlpha: 1, y: 0, duration: 0.45, ease: E.out }, 1.7)
      .to(q(scene, ".copy"), { scale: 0.92, duration: 0.1, yoyo: true, repeat: 1, ease: E.in }, 2.15)
      .add(() => setCopy("IDENTIFY", "The recipient is not anonymous."))
      .to(ident, { autoAlpha: 1, y: 0, duration: 0.45, ease: E.out }, 2.4)
      .add(() => setCopy("VIEW", "The recipient opens it. The page is marked."))
      .add(() => showShot(scene, "secure"), 2.9)
      .add(() => setCopy("TRACK", "The sender sees the access."))
      .add(() => showShot(scene, "audit"), 3.55)
      .to(viewed, { autoAlpha: 1, y: 0, duration: 0.5, ease: E.out }, 3.7)
      .add(() => motifTo(q(scene, ".event-slot"), { duration: 0.55, color: "#f3f3f0" }), 3.75);
    return t;
  }

  function buildLoop(scene) {
    const t = gsap.timeline();
    const items = qa(scene, ".loop-path span");
    const rules = qa(scene, ".loop-path i");
    const hope = q(scene, ".hope");
    const known = q(scene, ".known");
    const strike = q(scene, ".struck b");
    gsap.set(items, { autoAlpha: 0, y: 12 });
    gsap.set(rules, { scaleX: 0 });
    gsap.set(hope, { autoAlpha: 0, y: 10 });
    gsap.set(known, { autoAlpha: 0, y: 10 });
    gsap.set(strike, { scaleX: 0 });
    resetMotif(innerWidth * 0.14, innerHeight * 0.26, 0, "#8a8a8a");

    items.forEach((item, i) => {
      t.to(item, { autoAlpha: 1, y: 0, duration: 0.3, ease: E.out }, i === 0 ? 0.15 : ">");
      if (rules[i]) t.to(rules[i], { scaleX: 1, duration: 0.28, ease: E.out }, ">-0.04");
    });

    t.to(motif, { left: innerWidth * 0.52, top: innerHeight * 0.26, scale: 1, duration: 0.5, ease: E.out }, 0.95)
      .to(hope, { autoAlpha: 1, y: 0, duration: 0.45, ease: E.out }, 1.85)
      .to(strike, { scaleX: 1, duration: 0.32, ease: E.out }, 2.2)
      .to(known, { autoAlpha: 1, y: 0, duration: 0.5, ease: E.out }, 2.45);

    return t;
  }

  function buildInsight(scene) {
    const t = gsap.timeline();
    const lines = qa(scene, ".statement .mask > span");
    gsap.set(lines, { yPercent: 110 });
    resetMotif(innerWidth * 0.5, innerHeight * 0.5, 0, "#8a8a8a");
    t.to(lines, { yPercent: 0, duration: 0.8, ease: E.out, stagger: 0.14 }, 0.2)
      .add(() => motifTo(q(scene, ".end-slot"), { duration: 0.7 }), 1.15)
      .to({}, { duration: 0.8 });
    return t;
  }

  function buildPassport(scene) {
    const t = gsap.timeline();
    const quiet = q(scene, ".quiet");
    const title = qa(scene, ".passport-q .mask > span");
    const card = q(scene, ".passport");
    const items = qa(scene, ".passport li");
    const note = q(scene, ".future-note");
    gsap.set(quiet, { autoAlpha: 0, y: 8 });
    gsap.set(title, { yPercent: 110 });
    gsap.set(card, { autoAlpha: 0 });
    gsap.set(items, { autoAlpha: 0, x: -8 });
    gsap.set(note, { autoAlpha: 0 });
    resetMotif(innerWidth * 0.78, innerHeight * 0.28, 0, "#8a8a8a");

    t.to(quiet, { autoAlpha: 1, y: 0, duration: 0.4, ease: E.out }, 0.1)
      .to(title, { yPercent: 0, duration: 0.7, ease: E.out, stagger: 0.12 }, 0.45)
      .to(card, { autoAlpha: 1, duration: 0.35 }, 1.05)
      .to(items, { autoAlpha: 1, x: 0, duration: 0.35, ease: E.out, stagger: 0.07 }, 1.15)
      .to(note, { autoAlpha: 1, duration: 0.45 }, 2.05)
      .to(motif, { autoAlpha: 0, duration: 0.3 }, 0.1);
    return t;
  }

  function buildAi(scene) {
    const t = gsap.timeline();
    const lead = qa(scene, ".ai-lead .mask > span");
    const actors = qa(scene, ".actors span");
    const rules = qa(scene, ".actors i");
    const asks = qa(scene, ".ai-asks p");
    gsap.set(lead, { yPercent: 110 });
    gsap.set(actors, { autoAlpha: 0, y: 10 });
    gsap.set(rules, { scaleX: 0 });
    gsap.set(asks, { autoAlpha: 0, y: 12 });
    resetMotif(innerWidth * 0.5, innerHeight * 0.52, 0, "#8a8a8a");

    t.to(lead, { yPercent: 0, duration: 0.7, ease: E.out, stagger: 0.12 }, 0.12)
      .to(actors[0], { autoAlpha: 1, y: 0, duration: 0.35, ease: E.out }, 0.95)
      .to(rules[0], { scaleX: 1, duration: 0.32, ease: E.out }, 1.12)
      .to(actors[1], { autoAlpha: 1, y: 0, duration: 0.35, ease: E.out }, 1.28)
      .to(rules[1], { scaleX: 1, duration: 0.32, ease: E.out }, 1.45)
      .to(actors[2], { autoAlpha: 1, y: 0, duration: 0.35, ease: E.out }, 1.6)
      .to(motif, { scale: 1, duration: 0.4, ease: E.out }, 1.6)
      .to(asks, { autoAlpha: 1, y: 0, duration: 0.5, ease: E.out, stagger: 0.16 }, 2.05);
    return t;
  }

  function buildBigger(scene) {
    const t = gsap.timeline();
    const now = q(scene, ".bigger-now");
    const turn = qa(scene, ".bigger-turn .mask > span");
    const ask = qa(scene, ".bigger-q .mask > span");
    const actors = qa(scene, ".actors-col span");
    const rules = qa(scene, ".actors-col i");
    gsap.set(now, { autoAlpha: 0, y: 8 });
    gsap.set(turn, { yPercent: 110 });
    gsap.set(ask, { yPercent: 110 });
    gsap.set(actors, { autoAlpha: 0, y: 10 });
    gsap.set(rules, { scaleY: 0 });
    resetMotif(innerWidth * 0.14, innerHeight * 0.14, 0, "#8a8a8a");

    t.to(now, { autoAlpha: 1, y: 0, duration: 0.45, ease: E.out }, 0.15)
      .to({}, { duration: 0.7 })
      .to(turn, { yPercent: 0, duration: 0.72, ease: E.out, stagger: 0.1 })
      .to({}, { duration: 0.45 })
      .to(ask, { yPercent: 0, duration: 0.6, ease: E.out, stagger: 0.08 })
      .to(actors[0], { autoAlpha: 1, y: 0, duration: 0.32, ease: E.out }, ">-0.1")
      .to(rules[0], { scaleY: 1, duration: 0.22, ease: E.out })
      .to(actors[1], { autoAlpha: 1, y: 0, duration: 0.32, ease: E.out })
      .to(rules[1], { scaleY: 1, duration: 0.22, ease: E.out })
      .to(actors[2], { autoAlpha: 1, y: 0, duration: 0.35, ease: E.out })
      .to(motif, { scale: 1, duration: 0.4, ease: E.out }, "<");
    return t;
  }

  function buildCapability(scene) {
    const t = gsap.timeline();
    const kicker = q(scene, ".cap-kicker");
    const lines = qa(scene, ".cap-line .mask > span");
    gsap.set(kicker, { autoAlpha: 0, y: 8 });
    gsap.set(lines, { yPercent: 110 });
    resetMotif(innerWidth * 0.5, innerHeight * 0.48, 0, "#8a8a8a");

    t.to(kicker, { autoAlpha: 1, y: 0, duration: 0.4, ease: E.out }, 0.2)
      .to(lines[0], { yPercent: 0, duration: 0.7, ease: E.out }, 0.45)
      .to(lines[1], { yPercent: 0, duration: 0.7, ease: E.out }, ">-0.38")
      .to({}, { duration: 0.4 })
      .to(lines[2], { yPercent: 0, duration: 0.7, ease: E.out })
      .to(lines[3], { yPercent: 0, duration: 0.85, ease: E.out }, ">-0.38")
      .add(() => motifTo(q(scene, ".slot"), { duration: 0.8 }), ">-0.2")
      .to({}, { duration: 0.7 });
    return t;
  }

  function buildAgent(scene) {
    const t = gsap.timeline();
    const kicker = q(scene, ".agent-kicker");
    const card = q(scene, ".policy-card");
    const meta = qa(scene, ".policy-meta p");
    const allow = qa(scene, ".allow li");
    const deny = qa(scene, ".deny li");
    const auth = q(scene, ".authorize");
    const process = q(scene, ".process");
    const processLine = q(scene, ".process i");
    const result = q(scene, ".agent-result");
    const stamps = qa(scene, ".stamps span");
    const log = q(scene, ".agent-log");
    const events = qa(scene, ".agent-log li");

    gsap.set(kicker, { autoAlpha: 0, y: 8 });
    gsap.set(card, { autoAlpha: 0, y: 18 });
    gsap.set(meta, { autoAlpha: 0, y: 8 });
    gsap.set([...allow, ...deny], { autoAlpha: 0, x: -10 });
    gsap.set(auth, { autoAlpha: 0, y: 8 });
    gsap.set(process, { autoAlpha: 0 });
    gsap.set(processLine, { scaleX: 0 });
    gsap.set(result, { autoAlpha: 0, y: 12 });
    gsap.set(stamps, { autoAlpha: 0, y: 6 });
    gsap.set(log, { autoAlpha: 0 });
    gsap.set(events, { autoAlpha: 0, x: -8 });
    resetMotif(innerWidth * 0.22, innerHeight * 0.22, 0, "#8a8a8a");

    t.to(kicker, { autoAlpha: 1, y: 0, duration: 0.35, ease: E.out }, 0.08)
      .to(card, { autoAlpha: 1, y: 0, duration: 0.55, ease: E.out }, 0.18)
      .to(meta, { autoAlpha: 1, y: 0, duration: 0.35, ease: E.out, stagger: 0.08 }, 0.4)
      .to(allow, { autoAlpha: 1, x: 0, duration: 0.32, ease: E.out, stagger: 0.07 }, 0.7)
      .to(deny, { autoAlpha: 1, x: 0, duration: 0.32, ease: E.out, stagger: 0.06 }, 0.95)
      .to(auth, { autoAlpha: 1, y: 0, duration: 0.35, ease: E.out }, 1.25)
      .to(auth, { scale: 0.96, duration: 0.1, yoyo: true, repeat: 1, ease: E.in }, 1.7)
      .to(process, { autoAlpha: 1, duration: 0.3 }, 1.9)
      .to(processLine, { scaleX: 1, duration: 0.85, ease: E.inout }, 1.95)
      .to(motif, { left: innerWidth * 0.32, top: innerHeight * 0.62, scale: 1.1, duration: 0.7, ease: E.out }, 1.95)
      .to(result, { autoAlpha: 1, y: 0, duration: 0.5, ease: E.out }, 2.75)
      .to(stamps, { autoAlpha: 1, y: 0, duration: 0.35, ease: E.out, stagger: 0.1 }, 3.05)
      .to(log, { autoAlpha: 1, duration: 0.25 }, 3.25)
      .to(events, { autoAlpha: 1, x: 0, duration: 0.28, ease: E.out, stagger: 0.06 }, 3.3);
    return t;
  }

  function buildLifecycle(scene) {
    const t = gsap.timeline();
    const quiet = q(scene, ".quiet");
    const title = qa(scene, ".passport-q .mask > span");
    const card = q(scene, ".passport");
    const items = qa(scene, ".passport li");
    gsap.set(quiet, { autoAlpha: 0, y: 8 });
    gsap.set(title, { yPercent: 110 });
    gsap.set(card, { autoAlpha: 0 });
    gsap.set(items, { autoAlpha: 0, x: -8 });
    resetMotif(innerWidth * 0.78, innerHeight * 0.28, 0, "#8a8a8a");

    t.to(quiet, { autoAlpha: 1, y: 0, duration: 0.4, ease: E.out }, 0.1)
      .to(title, { yPercent: 0, duration: 0.7, ease: E.out, stagger: 0.12 }, 0.4)
      .to(card, { autoAlpha: 1, duration: 0.3 }, 1.0)
      .to(items, { autoAlpha: 1, x: 0, duration: 0.32, ease: E.out, stagger: 0.07 }, 1.1)
      .to(motif, { autoAlpha: 0, duration: 0.3 }, 0.1);
    return t;
  }

  function buildArch(scene) {
    const t = gsap.timeline();
    const kicker = q(scene, ".layer-kicker");
    const stack = qa(scene, ".arch-stack p, .arch-stack small");
    const rules = qa(scene, ".arch-stack i");
    const note = q(scene, ".arch-note");
    const tech = q(scene, ".arch-tech");
    gsap.set(kicker, { autoAlpha: 0, y: 8 });
    gsap.set(stack, { autoAlpha: 0, y: 14 });
    gsap.set(rules, { scaleY: 0 });
    gsap.set([note, tech].filter(Boolean), { autoAlpha: 0 });
    resetMotif(innerWidth * 0.14, innerHeight * 0.3, 0, "#8a8a8a");

    t.to(kicker, { autoAlpha: 1, y: 0, duration: 0.35, ease: E.out }, 0.12)
      .to(stack[0], { autoAlpha: 1, y: 0, duration: 0.4, ease: E.out }, 0.3)
      .to(stack[1], { autoAlpha: 1, y: 0, duration: 0.35, ease: E.out }, 0.48)
      .to(rules[0], { scaleY: 1, duration: 0.22, ease: E.out }, 0.7)
      .to(stack[2], { autoAlpha: 1, y: 0, duration: 0.4, ease: E.out }, 0.85)
      .to(rules[1], { scaleY: 1, duration: 0.22, ease: E.out }, 1.05)
      .to(stack[3], { autoAlpha: 1, y: 0, duration: 0.4, ease: E.out }, 1.18)
      .to(rules[2], { scaleY: 1, duration: 0.22, ease: E.out }, 1.38)
      .to(stack[4], { autoAlpha: 1, y: 0, duration: 0.4, ease: E.out }, 1.5)
      .to(motif, { scale: 1, duration: 0.35, ease: E.out }, 0.3)
      .to(tech, { autoAlpha: 1, duration: 0.4 }, 1.7)
      .to(note, { autoAlpha: 1, duration: 0.45 }, 1.9);
    return t;
  }

  function buildPosition(scene) {
    const t = gsap.timeline();
    const rows = qa(scene, ".pos-rows p");
    const line = qa(scene, ".pos-line span, .pos-line strong");
    gsap.set(rows, { autoAlpha: 0, y: 16 });
    gsap.set(line, { autoAlpha: 0, y: 12 });
    resetMotif(innerWidth * 0.14, innerHeight * 0.22, 0, "#8a8a8a");

    t.to(rows[0], { autoAlpha: 1, y: 0, duration: 0.45, ease: E.out }, 0.15)
      .to(rows[1], { autoAlpha: 1, y: 0, duration: 0.45, ease: E.out }, 0.5)
      .to(rows[2], { autoAlpha: 1, y: 0, duration: 0.55, ease: E.out }, 0.95)
      .to(line, { autoAlpha: 1, y: 0, duration: 0.5, ease: E.out, stagger: 0.1 }, 1.45)
      .to(motif, { scale: 1, duration: 0.4, ease: E.out }, 0.95);
    return t;
  }

  function buildMarket(scene) {
    const t = gsap.timeline();
    const lead = qa(scene, ".market-lead .mask > span");
    const items = qa(scene, ".markets li");
    const tiers = q(scene, ".tiers");
    gsap.set(lead, { yPercent: 110 });
    gsap.set(items, { autoAlpha: 0, x: -18, color: "#5a5a5a" });
    gsap.set(tiers, { autoAlpha: 0, y: 10 });
    resetMotif(innerWidth * 0.14, innerHeight * 0.5, 0, "#8a8a8a");

    t.to(lead, { yPercent: 0, duration: 0.65, ease: E.out, stagger: 0.1 }, 0.1);
    items.forEach((item, i) => {
      t.to(item, { autoAlpha: 1, x: 0, duration: 0.38, ease: E.out }, 0.7 + i * 0.16)
        .to(item, { color: i === items.length - 1 ? "#f3f3f0" : i === 0 ? "#f3f3f0" : "#bdbdbd", duration: 0.3 }, "<");
    });
    t.to(tiers, { autoAlpha: 1, y: 0, duration: 0.45, ease: E.out }, 1.55);
    return t;
  }

  function buildAdvantage(scene) {
    const t = gsap.timeline();
    const dim = qa(scene, ".col.dim p, .col.dim small");
    const live = qa(scene, ".col.live p, .col.live small");
    const line = qa(scene, ".advantage-line span, .advantage-line strong");
    gsap.set([...dim, ...live, ...line], { autoAlpha: 0, y: 14 });
    resetMotif(innerWidth * 0.5, innerHeight * 0.2, 0, "#8a8a8a");

    t.to(dim, { autoAlpha: 1, y: 0, duration: 0.4, ease: E.out, stagger: 0.06 }, 0.12)
      .to(live, { autoAlpha: 1, y: 0, duration: 0.4, ease: E.out, stagger: 0.07 }, 0.55)
      .to(line, { autoAlpha: 1, y: 0, duration: 0.5, ease: E.out, stagger: 0.1 }, 1.15)
      .to(motif, { scale: 1, duration: 0.4, ease: E.out }, 1.15);
    return t;
  }

  function buildProof(scene) {
    const t = gsap.timeline();
    const lead = qa(scene, ".proof-lead .mask > span");
    const devices = qa(scene, ".proof-devices .device");
    const facts = qa(scene, ".proof-facts li");
    gsap.set(lead, { yPercent: 110 });
    gsap.set(devices, { y: 48, autoAlpha: 0 });
    gsap.set(facts, { autoAlpha: 0, y: 8 });
    resetMotif(innerWidth * 0.18, innerHeight * 0.16, 0, "#8a8a8a");

    t.to(lead, { yPercent: 0, duration: 0.7, ease: E.out, stagger: 0.12 }, 0.1)
      .to(devices, { y: 0, autoAlpha: 1, duration: 0.7, ease: E.out, stagger: 0.12 }, 0.45)
      .to(facts, { autoAlpha: 1, y: 0, duration: 0.35, ease: E.out, stagger: 0.06 }, 1.05)
      .to(motif, { scale: 1, duration: 0.4, ease: E.out }, 0.5);
    return t;
  }

  function buildTeam(scene) {
    const t = gsap.timeline();
    const photo = q(scene, ".founder-photo");
    const name = qa(scene, ".team-name .mask > span");
    const rest = qa(scene, ".team-role, .team-solo, .team-pipe, .team-quote, .team-ask, .team-maturity, .team-looking");
    gsap.set(photo, { autoAlpha: 0, x: -20 });
    gsap.set(name, { yPercent: 110 });
    gsap.set(rest, { autoAlpha: 0, y: 10 });
    resetMotif(innerWidth * 0.18, innerHeight * 0.16, 0, "#8a8a8a");

    t.to(photo, { autoAlpha: 1, x: 0, duration: 0.7, ease: E.out }, 0.1)
      .to(name, { yPercent: 0, duration: 0.72, ease: E.out }, 0.28)
      .to(rest, { autoAlpha: 1, y: 0, duration: 0.4, ease: E.out, stagger: 0.07 }, 0.72)
      .to(motif, { scale: 1, duration: 0.4, ease: E.out }, 0.28);
    return t;
  }

  function buildFinale(scene) {
    const t = gsap.timeline();
    const a = qa(scene, ".final-a .mask > span");
    const b = qa(scene, ".final-b .mask > span");
    const c = qa(scene, ".final-c .mask > span");
    const cta = q(scene, ".final-cta");
    gsap.set(a, { yPercent: 110 });
    gsap.set(b, { yPercent: 110 });
    gsap.set(c, { yPercent: 110 });
    gsap.set([q(scene, ".final-a"), q(scene, ".final-b"), q(scene, ".final-c")], { autoAlpha: 1 });
    gsap.set(cta, { autoAlpha: 0, y: 16 });
    resetMotif(innerWidth * 0.5, innerHeight * 0.5, 0, "#8a8a8a");

    t.to(a, { yPercent: 0, duration: 0.7, ease: E.out, stagger: 0.08 }, 0.2)
      .to({}, { duration: 0.85 })
      .to(q(scene, ".final-a"), { autoAlpha: 0, duration: 0.35, ease: E.in })
      .to(b, { yPercent: 0, duration: 0.7, ease: E.out, stagger: 0.08 })
      .to({}, { duration: 0.8 })
      .to(q(scene, ".final-b"), { autoAlpha: 0, duration: 0.35, ease: E.in })
      .to(c, { yPercent: 0, duration: 0.7, ease: E.out, stagger: 0.08 })
      .to({}, { duration: 0.95 })
      .to(q(scene, ".final-c"), { autoAlpha: 0, duration: 0.35, ease: E.in })
      .to(cta, { autoAlpha: 1, y: 0, duration: 0.8, ease: E.out })
      .add(() => motifTo(q(scene, ".final-mark .slot"), { duration: 0.8 }), "<0.15")
      .to({}, { duration: 1.2 });
    return t;
  }

  const builders = {
    hook: buildHook,
    send: buildSend,
    questions: buildQuestions,
    storage: buildStorage,
    reveal: buildReveal,
    product: buildProduct,
    loop: buildLoop,
    insight: buildInsight,
    passport: buildPassport,
    ai: buildAi,
    bigger: buildBigger,
    capability: buildCapability,
    agent: buildAgent,
    lifecycle: buildLifecycle,
    arch: buildArch,
    position: buildPosition,
    market: buildMarket,
    advantage: buildAdvantage,
    proof: buildProof,
    team: buildTeam,
    finale: buildFinale,
  };

  const dipIn = new Set(["reveal", "capability", "finale", "hook", "proof"]);

  function stop() {
    if (tl) {
      tl.kill();
      tl = null;
    }
    gsap.killTweensOf(motif);
  }

  function play(i, { fromBlack = false } = {}) {
    const scene = scenes[i];
    const name = scene.dataset.scene;
    scenes.forEach((s, n) => s.classList.toggle("is-on", n === i));
    counter.textContent = String(i + 1).padStart(2, "0");
    gsap.to(fill, { scaleX: (i + 1) / scenes.length, duration: 0.45, ease: E.out, transformOrigin: "left center" });
    document.title = `NO SUS. — ${scene.dataset.label}`;
    history.replaceState(null, "", `${location.pathname}${location.search}#${String(i + 1).padStart(2, "0")}`);

    stop();
    gsap.set(scene.querySelectorAll("*"), { clearProps: "transform,opacity,visibility,clipPath" });

    const start = () => {
    const build = builders[name];
    tl = build ? build(scene) : gsap.timeline();
    if (REDUCE) tl.progress(1);
    gsap.set(curtain, { opacity: 0 });
    };

    if (fromBlack || dipIn.has(name)) {
      gsap.set(curtain, { opacity: 1 });
      gsap.to(curtain, { opacity: 0, duration: name === "finale" || name === "reveal" || name === "capability" ? 0.55 : 0.28, ease: "none", onStart: start });
    } else {
      start();
    }
  }

  function go(next, { fromRemote = false } = {}) {
    const clamped = Math.max(0, Math.min(scenes.length - 1, next));
    if (clamped === index && scenes[index].classList.contains("is-on") && tl) return;
    const prev = index;
    index = clamped;
    const fromBlack = dipIn.has(scenes[index].dataset.scene) || scenes[prev]?.dataset.scene === "questions";
    play(index, { fromBlack });
    if (!fromRemote) syncHostState();
  }

  function showControls() {
    controls.classList.add("is-visible");
    document.body.classList.add("is-pointer");
    clearTimeout(hideT);
    clearTimeout(pointerT);
    hideT = setTimeout(() => controls.classList.remove("is-visible"), 1600);
    pointerT = setTimeout(() => document.body.classList.remove("is-pointer"), 1800);
  }

  document.querySelector("#next").addEventListener("click", (e) => { e.stopPropagation(); go(index + 1); });
  document.querySelector("#prev").addEventListener("click", (e) => { e.stopPropagation(); go(index - 1); });
  document.querySelector("#fullscreen").addEventListener("click", async (e) => {
    e.stopPropagation();
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  });

  document.addEventListener("keydown", (e) => {
    if (["ArrowRight", " ", "PageDown", "Enter"].includes(e.key)) { e.preventDefault(); go(index + 1); }
    if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); go(index - 1); }
    if (e.key === "Home") { e.preventDefault(); go(0); }
    if (e.key === "End") { e.preventDefault(); go(scenes.length - 1); }
    if (e.key.toLowerCase() === "f") document.querySelector("#fullscreen").click();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("button, a, .controls, .qr")) go(index + 1);
  });

  document.addEventListener("touchstart", (e) => { touchX = e.changedTouches[0].screenX; }, { passive: true });
  document.addEventListener("touchend", (e) => {
    const d = e.changedTouches[0].screenX - touchX;
    if (Math.abs(d) > 48) go(index + (d < 0 ? 1 : -1));
  }, { passive: true });

  window.addEventListener("hashchange", () => {
    const n = parseInt((location.hash || "").replace("#", ""), 10);
    if (Number.isFinite(n)) go(n - 1);
  });
  window.addEventListener("resize", () => {
    if (tl && tl.progress() === 1) {
      const slot = scenes[index].querySelector("[data-slot] .slot, .slot");
      if (slot) motifTo(slot, { duration: 0 });
    }
  });

  gsap.set(fill, { scaleX: 1 / scenes.length, transformOrigin: "left center" });
  const fromHash = parseInt((location.hash || "").replace("#", ""), 10);
  index = Number.isFinite(fromHash) && fromHash >= 1 && fromHash <= scenes.length ? fromHash - 1 : 0;
  play(index, { fromBlack: true });
  pollRemoteState();
  if (REMOTE_SYNC) window.setInterval(pollRemoteState, 350);
})();
