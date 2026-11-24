"use strict";
const TOKEN = decodeURIComponent(location.pathname.split("/").pop() || "");
const STORE_KEY = "la_progress_" + TOKEN;
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const hasTTS = "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

let info = null;     // invite info from server
let T = null;        // test session state
let tickTimer = null;
let deadline = 0;

/* ---------- persistence (resume after refresh) ---------- */
function persist() {
  if (!T) return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ step: T.step, answers: T.answers, speaking: T.speaking, tabSwitches: T.tabSwitches, listenFallback: T.listenFallback, plays: T.plays })); } catch { /* storage unavailable */ }
}
function restore() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch { return null; } }
function clearStore() { try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ } }

/* ---------- boot ---------- */
(async function boot() {
  try { info = await api("GET", "/api/invite/" + encodeURIComponent(TOKEN)); }
  catch (e) { return mount(h("div", { class: "card center", style: "padding:40px" }, h("h2", {}, "Link not valid"), h("p", { class: "muted" }, e.message))); }
  if (info.settings.orgName) document.getElementById("org").textContent = "· " + info.settings.orgName;
  if (info.status === "completed") return renderAlreadyDone();
  if (info.status === "in_progress" && info.test) return beginTest(info.test, info.remainingSec, info.preset, true);
  renderIntro();
})();

function renderAlreadyDone() {
  mount(h("div", { class: "card center", style: "padding:40px" }, h("h2", {}, "Assessment already completed"),
    h("p", { class: "muted" }, "Thank you — your results have been sent to the recruiting team. You can close this page.")));
}

/* ---------- intro ---------- */
function renderIntro() {
  const p = info.preset || {};
  const nameI = h("input", { type: "text", placeholder: "Full name", value: p.name || "" });
  const contactI = h("input", { type: "text", placeholder: "Email or candidate ID", value: p.contact || "" });
  const roleI = h("input", { type: "text", placeholder: "e.g. Customer Support – German desk", value: p.role || "" });
  const lockedLang = !!p.language;
  const ls = langSelect(p.language);
  const err = h("div", { class: "notice warn hidden" });
  const btn = h("button", { class: "primary", onclick: start }, "Start assessment");

  const notes = [];
  if (!SpeechRec) notes.push("Voice input isn't supported in this browser — speaking answers will be typed. For the best experience use Google Chrome or Microsoft Edge on a computer.");
  if (!hasTTS) notes.push("Audio playback isn't supported in this browser — listening clips will be shown as text.");

  async function start() {
    const lang = lockedLang ? { name: p.language, code: p.langCode || "" } : ls.get();
    const name = nameI.value.trim();
    if (!name || !lang.name) { err.textContent = "Please enter your name and choose a language."; err.classList.remove("hidden"); return; }
    btn.disabled = true;
    const status = h("div", { class: "muted" }, `Building your ${lang.name} assessment…`);
    mount(h("div", { class: "card center", style: "padding:48px" }, h("div", { class: "spinner" }), status, h("p", { class: "muted", style: "font-size:13px" }, "This usually takes 20–60 seconds. Please don't close the page.")));
    try {
      const r = await api("POST", `/api/invite/${encodeURIComponent(TOKEN)}/start`, { name, contact: contactI.value.trim(), role: roleI.value.trim(), language: lang.name, langCode: lang.code });
      beginTest(r.test, r.remainingSec, { name, language: lang.name, langCode: lang.code }, false);
    } catch (e) {
      mount(h("div", { class: "card center", style: "padding:40px" }, h("h3", {}, "Couldn't build the assessment"), h("p", { class: "muted" }, e.message),
        h("button", { class: "primary", onclick: renderIntro }, "Try again")));
    }
  }

  mount(
    h("div", { class: "card" },
      h("h2", {}, "Welcome"),
      h("p", { class: "muted" }, "This assessment measures your proficiency across four skills and reports a level on the CEFR scale (A1–C2). Questions are generated fresh for you."),
      h("div", { class: "skills" }, [["Grammar & vocabulary", "12 questions"], ["Reading", "2 passages"], ["Listening", "2 audio clips"], ["Speaking", "3 spoken prompts"]]
        .map(([a, b]) => h("div", { class: "skill" }, h("div", { class: "name" }, a), h("div", { style: "font-weight:600;margin-top:4px" }, b)))),
      h("p", { class: "muted", style: "margin-top:14px;font-size:14px" }, `You'll have ${info.settings.timeLimitMin} minutes once you start. Please stay on this page — leaving it is recorded. Use headphones and a microphone in a quiet place. The link can be used only once.`),
      notes.map((n) => h("div", { class: "notice warn" }, n))),
    h("div", { class: "card" },
      h("h3", {}, "Your details"),
      h("div", { class: "grid2" }, h("div", {}, h("label", {}, "Name *"), nameI), h("div", {}, h("label", {}, "Email / candidate ID"), contactI)),
      h("label", {}, "Role applied for"), roleI,
      h("label", {}, "Language to be assessed *"),
      lockedLang ? h("div", { class: "pill", style: "font-size:14px;padding:6px 12px" }, p.language) : ls.nodes,
      err,
      h("div", { class: "row", style: "margin-top:18px" }, h("div", { class: "spacer" }), btn)));
}

/* ---------- test session ---------- */
function beginTest(test, remainingSec, preset, resumed) {
  const saved = resumed ? restore() : null;
  T = {
    content: test, lang: { name: preset.language, code: preset.langCode || "" }, name: preset.name,
    step: saved?.step || 0, answers: saved?.answers || { grammar: {}, reading: {}, listening: {} },
    speaking: saved?.speaking || test.speaking.map(() => ({ text: "", mode: SpeechRec && preset.langCode ? "voice" : "typed", seconds: 0 })),
    tabSwitches: saved?.tabSwitches || 0, listenFallback: !!saved?.listenFallback, plays: saved?.plays || {},
  };
  deadline = Date.now() + remainingSec * 1000;
  startTick(); renderStep(); persist();
}
function startTick() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    const el = document.getElementById("timer"); const left = (deadline - Date.now()) / 1000;
    if (el) el.textContent = left > 0 ? "Time left " + fmtDur(left) : "Time's up";
    if (left <= 0 && T && !T.submitting) submit(true);
  }, 1000);
}
document.addEventListener("visibilitychange", () => { if (document.hidden && T && !T.submitting) { T.tabSwitches++; persist(); } });
window.addEventListener("beforeunload", (e) => { if (T && !T.submitting) { e.preventDefault(); e.returnValue = ""; } });

const STEP_NAMES = ["Grammar & vocabulary", "Reading", "Listening", "Speaking"];
function stepHeader() {
  return h("div", {},
    h("div", { class: "row", style: "margin-bottom:10px" }, h("span", { class: "pill" }, T.lang.name), h("span", { class: "muted", style: "font-size:14px" }, T.name),
      h("div", { class: "spacer" }), h("span", { class: "timer", id: "timer" }, "")),
    h("div", { class: "steps" }, STEP_NAMES.map((n, i) => h("div", { class: "step" + (i === T.step ? " on" : i < T.step ? " done" : "") }, (i < T.step ? "✓ " : (i + 1) + ". ") + n))));
}
function mcqBlock(q, store, key) {
  const wrap = h("div", { class: "q" });
  const opts = q.options.map((o, i) => {
    const inp = h("input", { type: "radio", name: key, checked: store[key] === i });
    const lab = h("label", { class: "opt" + (store[key] === i ? " sel" : "") }, inp, h("span", {}, o));
    inp.addEventListener("change", () => { store[key] = i; opts.forEach((l, j) => l.classList.toggle("sel", j === i)); persist(); });
    return lab;
  });
  wrap.append(h("div", { class: "stem" }, h("span", { class: "tag" }, q.level), q.q), ...opts);
  return wrap;
}
function navRow(onNext, countUnanswered, label) {
  const warn = h("span", { class: "muted", style: "font-size:13px" }); let armed = false;
  return h("div", { class: "row", style: "margin-top:8px" }, warn, h("div", { class: "spacer" }),
    h("button", { class: "primary", onclick: () => {
      const n = countUnanswered ? countUnanswered() : 0;
      if (n > 0 && !armed) { armed = true; warn.textContent = `${n} unanswered — click again to continue anyway.`; return; }
      onNext();
    } }, label || "Next section →"));
}
function next() { T.step++; persist(); renderStep(); }
function renderStep() { [renderGrammar, renderReading, renderListening, renderSpeaking][Math.min(T.step, 3)](); }

function renderGrammar() {
  const C = T.content.grammar, A = T.answers.grammar;
  mount(stepHeader(), h("div", { class: "card" }, h("h3", {}, "Grammar & vocabulary"), h("p", { class: "muted", style: "margin-top:-4px" }, "Choose the best answer. Questions get progressively harder."),
    C.map((q, i) => mcqBlock(q, A, "g" + i))), navRow(next, () => C.filter((_, i) => A["g" + i] == null).length));
}
function renderReading() {
  const C = T.content.reading, A = T.answers.reading;
  mount(stepHeader(), C.map((p, pi) => h("div", { class: "card" },
    h("div", { class: "row" }, h("h3", { style: "margin:0" }, `Passage ${pi + 1}` + (p.title ? ` — ${p.title}` : "")), h("span", { class: "lvl" }, p.level)),
    h("div", { class: "passage", style: "margin-top:10px" }, p.passage),
    p.questions.map((q, qi) => mcqBlock(q, A, `r${pi}_${qi}`)))),
  navRow(next, () => { let n = 0; C.forEach((p, pi) => p.questions.forEach((_, qi) => { if (A[`r${pi}_${qi}`] == null) n++; })); return n; }));
}

/* --- listening via browser speech synthesis --- */
function loadVoices() {
  return new Promise((res) => {
    if (!hasTTS) return res([]);
    const v = speechSynthesis.getVoices(); if (v.length) return res(v);
    const done = () => res(speechSynthesis.getVoices());
    speechSynthesis.addEventListener("voiceschanged", done, { once: true }); setTimeout(done, 1500);
  });
}
function pickVoice(voices, code) {
  if (!code) return null;
  const lc = code.toLowerCase(), base = lc.split("-")[0];
  return voices.find((v) => v.lang.toLowerCase() === lc) || voices.find((v) => v.lang.toLowerCase().replace("_", "-").startsWith(base)) || null;
}
async function renderListening() {
  const C = T.content.listening, A = T.answers.listening, MAXP = 2;
  const voice = pickVoice(await loadVoices(), T.lang.code);
  const canPlay = hasTTS && !!voice;
  const cards = C.map((c, ci) => {
    T.plays[ci] = T.plays[ci] || 0;
    const status = h("span", { class: "muted", style: "font-size:13px" });
    const txt = h("div", { class: "passage hidden" }, c.script);
    const btn = h("button", { class: "primary" }, canPlay ? "▶ Play audio" : "Show clip text");
    const upd = () => { if (canPlay) { status.textContent = `Plays left: ${MAXP - T.plays[ci]}`; btn.disabled = T.plays[ci] >= MAXP; } };
    btn.addEventListener("click", () => {
      if (!canPlay) { T.listenFallback = true; persist(); txt.classList.remove("hidden"); btn.disabled = true; return; }
      if (T.plays[ci] >= MAXP) return;
      T.plays[ci]++; persist(); btn.disabled = true; btn.textContent = "Playing…";
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(c.script); u.voice = voice; u.lang = voice.lang; u.rate = 0.95;
      u.onend = u.onerror = () => { btn.textContent = "▶ Play again"; upd(); };
      speechSynthesis.speak(u); upd(); btn.disabled = true;
    });
    upd();
    return h("div", { class: "card" },
      h("div", { class: "row" }, h("h3", { style: "margin:0" }, `Clip ${ci + 1}`), h("span", { class: "lvl" }, c.level), h("div", { class: "spacer" }), status, btn),
      h("p", { class: "muted", style: "font-size:14px" }, canPlay ? `Listen carefully — each clip can be played up to ${MAXP} times. The text is not shown.` : `Your browser has no ${T.lang.name} voice installed, so the clip text is shown instead (noted on your report).`),
      txt, c.questions.map((q, qi) => mcqBlock(q, A, `l${ci}_${qi}`)));
  });
  if (T.step !== 2) return; // navigated away while voices loaded
  mount(stepHeader(), cards, navRow(() => { if (hasTTS) speechSynthesis.cancel(); next(); }, () => { let n = 0; C.forEach((c, ci) => c.questions.forEach((_, qi) => { if (A[`l${ci}_${qi}`] == null) n++; })); return n; }));
}

/* --- speaking via browser speech recognition --- */
let activeRec = null;
function renderSpeaking() {
  const C = T.content.speaking;
  const voiceOK = !!SpeechRec && !!T.lang.code;
  const cards = C.map((s, si) => {
    const ans = T.speaking[si];
    const finalSpan = h("span", {}, ans.text), partialSpan = h("span", { class: "partial" });
    const box = h("div", { class: "transcript" }, finalSpan, partialSpan);
    const stateEl = h("span", { class: "muted", style: "font-size:13px" });
    const recBtn = h("button", { class: "primary" }, ans.text ? "🎙 Continue speaking" : "🎙 Start speaking");
    const clearBtn = h("button", { onclick: () => { if (activeRec?.idx === si) return; ans.text = ""; ans.seconds = 0; finalSpan.textContent = ""; persist(); } }, "Clear & redo");
    const typed = h("textarea", { placeholder: "Type your answer here…", value: ans.text, class: "hidden" });
    typed.addEventListener("input", () => { ans.text = typed.value; persist(); });
    const toTyped = () => { ans.mode = "typed"; typed.value = ans.text; [box, recBtn, clearBtn, typeBtn].forEach((e) => e.classList.add("hidden")); typed.classList.remove("hidden"); persist(); };
    const typeBtn = h("button", { onclick: () => { if (activeRec?.idx === si) activeRec.stop(); toTyped(); } }, "Voice not working? Type instead");
    if (!voiceOK || ans.mode === "typed") setTimeout(toTyped);

    recBtn.addEventListener("click", () => {
      if (activeRec && activeRec.idx === si) { activeRec.stop(); return; }
      if (activeRec) return;
      const rec = new SpeechRec(); rec.lang = T.lang.code; rec.continuous = true; rec.interimResults = true;
      let wanted = true; const t0 = Date.now(); const base = ans.seconds;
      const ctl = { idx: si, stop: () => { wanted = false; try { rec.stop(); } catch { /* */ } } };
      activeRec = ctl;
      const tick = setInterval(() => { const sec = base + Math.round((Date.now() - t0) / 1000); stateEl.replaceChildren(h("span", { class: "mic" }, h("span", { class: "dot" }), "Listening… " + fmtDur(sec))); if (sec >= 120) ctl.stop(); }, 500);
      rec.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) { ans.text = (ans.text ? ans.text + " " : "") + r[0].transcript.trim(); finalSpan.textContent = ans.text; persist(); }
          else interim += r[0].transcript;
        }
        partialSpan.textContent = interim ? (ans.text ? " " : "") + interim : "";
      };
      rec.onerror = (ev) => {
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") { wanted = false; stateEl.textContent = "Microphone blocked — please type your answer."; toTyped(); }
        else if (ev.error === "language-not-supported") { wanted = false; stateEl.textContent = `Voice input doesn't support ${T.lang.name} in this browser — please type.`; toTyped(); }
      };
      rec.onend = () => {
        if (wanted) { try { rec.start(); return; } catch { /* fall through */ } } // browsers stop after silence: keep listening
        clearInterval(tick); activeRec = null; partialSpan.textContent = "";
        ans.seconds = base + Math.round((Date.now() - t0) / 1000); persist();
        recBtn.textContent = "🎙 Continue speaking";
        if (ans.mode !== "typed") stateEl.textContent = ans.seconds ? `Recorded ${fmtDur(ans.seconds)}` : "";
      };
      try { rec.start(); recBtn.textContent = "■ Stop"; } catch { activeRec = null; clearInterval(tick); stateEl.textContent = "Couldn't start the microphone — try again."; }
    });
    return h("div", { class: "card" },
      h("div", { class: "row" }, h("h3", { style: "margin:0" }, `Prompt ${si + 1}`), h("span", { class: "lvl" }, s.level)),
      h("p", { style: "font-size:17px;font-weight:500;margin:12px 0 4px" }, s.prompt),
      s.prompt_en && h("p", { class: "muted", style: "font-size:13px;margin-top:0" }, "EN: " + s.prompt_en),
      h("div", { class: "row" }, recBtn, clearBtn, stateEl, h("div", { class: "spacer" }), typeBtn),
      box, typed,
      h("p", { class: "muted", style: "font-size:12px;margin:8px 0 0" }, `Aim for 45–90 seconds, speaking in ${T.lang.name}. Recording stops automatically at 2 minutes.`));
  });
  mount(stepHeader(),
    h("div", { class: "notice" }, voiceOK ? `Speak naturally in ${T.lang.name}. Your speech is transcribed and evaluated for fluency, grammar, vocabulary and coherence. Pronunciation itself is not scored.` : "Voice input isn't available for this language or browser, so please type your answers."),
    cards, navRow(() => submit(false), () => T.speaking.filter((a) => !a.text.trim()).length, "Submit assessment"));
}

/* ---------- submit ---------- */
async function submit(timeUp) {
  if (T.submitting) return; T.submitting = true;
  if (activeRec) activeRec.stop(); if (hasTTS) speechSynthesis.cancel();
  await new Promise((r) => setTimeout(r, activeRec ? 800 : 0));
  clearInterval(tickTimer);
  mount(h("div", { class: "card center", style: "padding:48px" }, h("div", { class: "spinner" }), h("div", { class: "muted" }, timeUp ? "Time's up — submitting your answers…" : "Submitting and scoring your answers…")));
  const payload = { answers: { ...T.answers.grammar, ...T.answers.reading, ...T.answers.listening }, speaking: T.speaking, tabSwitches: T.tabSwitches, listenFallback: T.listenFallback, timeUp };
  try {
    const r = await api("POST", `/api/invite/${encodeURIComponent(TOKEN)}/submit`, payload);
    clearStore(); renderDone(r.report);
  } catch (e) {
    if (e.status === 409) { clearStore(); return renderDone(null); }
    T.submitting = false;
    mount(h("div", { class: "card center", style: "padding:40px" }, h("h3", {}, "Submission failed"), h("p", { class: "muted" }, e.message + " Your answers are kept on this device."),
      h("button", { class: "primary", onclick: () => submit(timeUp) }, "Try again")));
  }
}
function renderDone(report) {
  T = null;
  mount(
    h("div", { class: "card center", style: "padding:32px" }, h("h2", {}, "Assessment submitted"),
      h("p", { class: "muted" }, "Thank you. Your results have been sent to the recruiting team. You can close this page.")),
    report && h("div", { class: "card" },
      h("div", { class: "row", style: "align-items:flex-end" },
        h("div", {}, h("div", { class: "muted", style: "font-size:13px;font-weight:600" }, "Overall CEFR level"), h("div", { class: "big-lvl" }, report.overall.cefr)),
        h("div", { class: "muted", style: "max-width:420px" }, CEFR_DESC[report.overall.cefr] || "")),
      skillTiles(report.scores),
      report.scores.speaking?.feedback && h("div", { style: "margin-top:16px" }, h("h3", {}, "Speaking feedback"), h("p", { class: "muted" }, report.scores.speaking.feedback))));
}
