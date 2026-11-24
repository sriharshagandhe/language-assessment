"use strict";
const crypto = require("crypto");

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const WEIGHT = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

function scoreToCEFR(s) {
  if (s < 15) return "Pre-A1"; if (s < 30) return "A1"; if (s < 45) return "A2";
  if (s < 60) return "B1"; if (s < 75) return "B2"; if (s < 90) return "C1"; return "C2";
}
function weightedScore(items) {
  let tot = 0, got = 0;
  for (const it of items) { const w = WEIGHT[it.level] || 3; tot += w; if (it.correct) got += w; }
  return tot ? Math.round((got / tot) * 100) : 0;
}

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function validMCQ(q) {
  return q && typeof q.q === "string" && Array.isArray(q.options) && q.options.length >= 3 &&
    Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length;
}
function prepMCQ(q, fallbackLevel) {
  const opts = q.options.map((t, i) => ({ t: String(t), ok: i === q.answer }));
  const sh = shuffle(opts);
  return {
    level: LEVELS.includes(q.level) ? q.level : (LEVELS.includes(fallbackLevel) ? fallbackLevel : "B1"),
    q: String(q.q), options: sh.map((o) => o.t), answer: sh.findIndex((o) => o.ok),
  };
}

/** Build the full test (with answer keys) from the two AI responses. */
function buildTest(A, B) {
  const grammar = (A?.grammar || []).filter(validMCQ).map((q) => prepMCQ(q));
  const reading = (A?.reading || []).filter((p) => p && p.passage && Array.isArray(p.questions)).map((p) => ({
    level: String(p.level || ""), title: String(p.title || ""), passage: String(p.passage),
    questions: p.questions.filter(validMCQ).map((q) => prepMCQ(q, p.level)),
  }));
  const listening = (B?.listening || []).filter((c) => c && c.script && Array.isArray(c.questions)).map((c) => ({
    level: String(c.level || ""), script: String(c.script),
    questions: c.questions.filter(validMCQ).map((q) => prepMCQ(q, c.level)),
  }));
  const speaking = (B?.speaking || []).filter((s) => s && s.prompt).slice(0, 3).map((s) => ({
    level: String(s.level || "B1"), prompt: String(s.prompt), prompt_en: String(s.prompt_en || ""),
  }));
  if (grammar.length < 6 || !reading.length || !listening.length || !speaking.length) {
    throw new Error("Generated test was incomplete");
  }
  return { grammar, reading, listening, speaking };
}

/** Strip answer keys before sending to the browser. Listening scripts are sent
 * because the browser speaks them; they are only revealed if audio is unavailable. */
function publicTest(t) {
  const strip = (q) => ({ level: q.level, q: q.q, options: q.options });
  return {
    grammar: t.grammar.map(strip),
    reading: t.reading.map((p) => ({ level: p.level, title: p.title, passage: p.passage, questions: p.questions.map(strip) })),
    listening: t.listening.map((c) => ({ level: c.level, script: c.script, questions: c.questions.map(strip) })),
    speaking: t.speaking,
  };
}

function scoreMCQ(test, answers) {
  const A = answers || {};
  const pick = (k) => (Number.isInteger(A[k]) ? A[k] : null);
  const g = test.grammar.map((q, i) => ({ level: q.level, correct: pick("g" + i) === q.answer }));
  const r = []; test.reading.forEach((p, pi) => p.questions.forEach((q, qi) => r.push({ level: q.level, correct: pick(`r${pi}_${qi}`) === q.answer })));
  const l = []; test.listening.forEach((c, ci) => c.questions.forEach((q, qi) => l.push({ level: q.level, correct: pick(`l${ci}_${qi}`) === q.answer })));
  const mk = (items) => { const s = weightedScore(items); return { score: s, cefr: scoreToCEFR(s), correct: items.filter((x) => x.correct).length, total: items.length }; };
  return { grammar: mk(g), reading: mk(r), listening: mk(l) };
}

module.exports = { LEVELS, scoreToCEFR, weightedScore, buildTest, publicTest, scoreMCQ };
