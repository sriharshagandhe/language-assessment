"use strict";
try { process.loadEnvFile?.(); } catch { /* no .env file — rely on real environment */ }

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const { db, getSettings, saveSettings } = require("./src/db");
const ai = require("./src/ai");
const { buildTest, publicTest, scoreMCQ, scoreToCEFR, LEVELS } = require("./src/scoring");
const auth = require("./src/auth");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : "")).replace(/\/+$/, "");
const GRACE_SEC = 120; // extra seconds allowed after the time limit before a submission is flagged late

const app = express();
app.set("trust proxy", process.env.TRUST_PROXY === "false" ? false : 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "512kb" }));
app.use(cookieParser());

// Security headers
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "microphone=(self), camera=(), geolocation=()");
  next();
});

const newId = () => crypto.randomUUID();
const newToken = () => crypto.randomBytes(18).toString("base64url");
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const baseUrl = (req) => PUBLIC_URL || `${req.protocol}://${req.get("host")}`;

/* ============================== PAGES ============================== */
const pub = path.join(__dirname, "public");
app.use("/static", express.static(pub, { maxAge: "1h", index: false }));
app.get("/", (req, res) => res.redirect("/admin"));
app.get("/admin", (req, res) => res.sendFile(path.join(pub, "admin.html")));
app.get("/t/:token", (req, res) => res.sendFile(path.join(pub, "candidate.html")));
app.get("/open", auth.rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }), (req, res) => {
  if (!getSettings().allowOpenLink) return res.status(404).send("This assessment link is not active. Please ask the recruiter for a personal invite link.");
  const token = newToken();
  db.prepare("INSERT INTO invites(id, token, source, status, created_at) VALUES(?,?, 'open', 'unused', ?)").run(newId(), token, Date.now());
  res.redirect(`/t/${token}`);
});
app.get("/healthz", (req, res) => res.json({ ok: true }));

/* ============================== CANDIDATE API ============================== */
function loadInvite(token) {
  if (!token || token.length > 64) return null;
  return db.prepare("SELECT * FROM invites WHERE token = ?").get(token);
}
function remainingSec(inv, s) {
  if (!inv.started_at) return s.timeLimitMin * 60;
  return Math.round(s.timeLimitMin * 60 - (Date.now() - inv.started_at) / 1000);
}

app.get("/api/invite/:token", (req, res) => {
  const inv = loadInvite(req.params.token);
  if (!inv || inv.status === "expired") return res.status(404).json({ error: "This link is invalid or has expired." });
  const s = getSettings();
  const out = {
    status: inv.status,
    preset: { name: inv.name, contact: inv.contact, role: inv.role, language: inv.language, langCode: inv.lang_code },
    settings: { timeLimitMin: s.timeLimitMin, orgName: s.orgName },
  };
  if (inv.status === "in_progress" && inv.test_json) {
    out.test = publicTest(JSON.parse(inv.test_json));
    out.remainingSec = remainingSec(inv, s);
  }
  res.json(out);
});

const generating = new Set();
app.post("/api/invite/:token/start", auth.rateLimit({ windowMs: 10 * 60 * 1000, max: 6 }), async (req, res) => {
  const inv = loadInvite(req.params.token);
  if (!inv || inv.status === "expired") return res.status(404).json({ error: "This link is invalid or has expired." });
  if (inv.status === "completed") return res.status(409).json({ error: "This assessment has already been completed." });
  const s = getSettings();
  if (inv.status === "in_progress" && inv.test_json) {
    return res.json({ test: publicTest(JSON.parse(inv.test_json)), remainingSec: remainingSec(inv, s) });
  }
  const name = str(req.body.name, 120) || inv.name;
  const language = str(req.body.language, 80) || inv.language;
  if (!name || !language) return res.status(400).json({ error: "Name and language are required." });
  if (generating.has(inv.id)) return res.status(409).json({ error: "Your test is already being prepared — please wait." });
  generating.add(inv.id);
  try {
    const [A, B] = await Promise.all([
      ai.askJSON(ai.promptGrammarReading(language)),
      ai.askJSON(ai.promptListeningSpeaking(language)),
    ]);
    const test = buildTest(A, B);
    const now = Date.now();
    db.prepare(`UPDATE invites SET name=?, contact=?, role=?, language=?, lang_code=?, status='in_progress', started_at=?, test_json=? WHERE id=?`)
      .run(name, str(req.body.contact, 160) || inv.contact, str(req.body.role, 160) || inv.role, language,
        str(req.body.langCode, 20) || inv.lang_code || "", now, JSON.stringify(test), inv.id);
    res.json({ test: publicTest(test), remainingSec: s.timeLimitMin * 60 });
  } catch (e) {
    console.error("[start] generation failed:", e?.message || e);
    res.status(502).json({ error: "We couldn't prepare your assessment. Please try again in a minute." });
  } finally {
    generating.delete(inv.id);
  }
});

const submitting = new Set();
app.post("/api/invite/:token/submit", auth.rateLimit({ windowMs: 10 * 60 * 1000, max: 6 }), async (req, res) => {
  const inv = loadInvite(req.params.token);
  if (!inv) return res.status(404).json({ error: "This link is invalid." });
  if (inv.status === "completed") return res.status(409).json({ error: "This assessment has already been submitted." });
  if (inv.status !== "in_progress" || !inv.test_json) return res.status(400).json({ error: "Assessment not started." });
  if (submitting.has(inv.id)) return res.status(409).json({ error: "Submission in progress." });
  submitting.add(inv.id);
  try {
    const s = getSettings();
    const test = JSON.parse(inv.test_json);
    const body = req.body || {};
    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
    const scores = scoreMCQ(test, answers);
    const speakingIn = Array.isArray(body.speaking) ? body.speaking : [];
    const speaking = test.speaking.map((p, i) => {
      const a = speakingIn[i] || {};
      return { level: p.level, prompt: p.prompt, prompt_en: p.prompt_en, response: str(a.text, 6000), mode: a.mode === "voice" ? "voice" : "typed", seconds: Math.max(0, Math.min(600, Number(a.seconds) || 0)) };
    });

    let sp = { score: 0, cefr: "Pre-A1", feedback: "No spoken response was provided.", criteria: {}, perPrompt: [] };
    if (speaking.some((x) => x.response)) {
      try {
        const items = speaking.map((x) => ({ prompt_level: x.level, prompt: x.prompt, prompt_en: x.prompt_en, response: x.response || "(no response)", input: x.mode, seconds: x.seconds }));
        const r = await ai.askJSON(ai.promptSpeakingGrade(inv.language, items), 2000);
        const sc = Math.max(0, Math.min(100, Math.round(Number(r?.score) || 0)));
        const crit = {};
        if (r?.criteria && typeof r.criteria === "object") for (const k of ["fluency", "grammar", "vocabulary", "coherence"]) if (r.criteria[k] != null) crit[k] = Math.max(0, Math.min(100, Math.round(Number(r.criteria[k]) || 0)));
        sp = {
          score: sc,
          cefr: ["Pre-A1", ...LEVELS].includes(r?.cefr) ? r.cefr : scoreToCEFR(sc),
          feedback: str(r?.feedback, 2000),
          criteria: crit,
          perPrompt: (Array.isArray(r?.perPrompt) ? r.perPrompt : []).slice(0, 3).map((p) => ({ cefr: str(p?.cefr, 10), comment: str(p?.comment, 400) })),
        };
      } catch (e) {
        console.error("[submit] speaking grading failed:", e?.message || e);
        sp = { score: null, cefr: "—", feedback: "Speaking could not be scored automatically. Please review the transcripts.", criteria: {}, perPrompt: [] };
      }
    }
    scores.speaking = sp;
    const parts = [scores.grammar.score, scores.reading.score, scores.listening.score].concat(sp.score == null ? [] : [sp.score]);
    const overallScore = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
    const now = Date.now();
    const durationSec = Math.round((now - inv.started_at) / 1000);
    const timeUp = durationSec > s.timeLimitMin * 60 + GRACE_SEC || !!body.timeUp;
    const tabSwitches = Math.max(0, Math.min(999, Number(body.tabSwitches) || 0));
    const listenFallback = !!body.listenFallback;
    const result = {
      scores, overall: { score: overallScore, cefr: scoreToCEFR(overallScore) }, speaking,
      flags: { tabSwitches, timeUp, listenFallback, late: durationSec > s.timeLimitMin * 60 + GRACE_SEC },
    };
    const id = newId();
    db.transaction(() => {
      db.prepare(`INSERT INTO results(id, invite_id, name, contact, role, language, lang_code, started_at, finished_at, duration_sec, time_up, tab_switches, listen_fallback, overall_cefr, overall_score, result_json)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, inv.id, inv.name, inv.contact, inv.role, inv.language, inv.lang_code, inv.started_at, now, durationSec, timeUp ? 1 : 0, tabSwitches, listenFallback ? 1 : 0, result.overall.cefr, overallScore, JSON.stringify(result));
      db.prepare("UPDATE invites SET status='completed', completed_at=?, result_id=? WHERE id=?").run(now, id, inv.id);
    })();
    res.json({ ok: true, report: s.showResults ? { overall: result.overall, scores } : null });
  } catch (e) {
    console.error("[submit] failed:", e);
    res.status(500).json({ error: "Your answers could not be saved. Please try submitting again." });
  } finally {
    submitting.delete(inv.id);
  }
});

/* ============================== ADMIN API ============================== */
app.post("/api/admin/login", auth.rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), (req, res) => {
  if (!auth.checkPassword(req.body?.password || "")) return res.status(401).json({ error: "Incorrect password." });
  auth.issue(res); res.json({ ok: true });
});
app.post("/api/admin/logout", (req, res) => { auth.clear(res); res.json({ ok: true }); });
app.get("/api/admin/me", (req, res) => res.json({ admin: auth.isAdmin(req) }));

const admin = express.Router();
admin.use(auth.requireAdmin);

admin.get("/settings", (req, res) => res.json(getSettings()));
admin.put("/settings", (req, res) => {
  const b = req.body || {}; const patch = {};
  if ("timeLimitMin" in b) patch.timeLimitMin = Math.max(10, Math.min(120, Math.round(Number(b.timeLimitMin) || 40)));
  if ("showResults" in b) patch.showResults = !!b.showResults;
  if ("allowOpenLink" in b) patch.allowOpenLink = !!b.allowOpenLink;
  if ("orgName" in b) patch.orgName = str(b.orgName, 80);
  res.json(saveSettings(patch));
});

admin.get("/invites", (req, res) => {
  const rows = db.prepare(`SELECT id, token, name, contact, role, language, source, status, created_at, started_at, completed_at, result_id
                           FROM invites WHERE NOT (source='open' AND status='unused') ORDER BY created_at DESC LIMIT 1000`).all();
  const base = baseUrl(req);
  res.json({ invites: rows.map((r) => ({ ...r, link: `${base}/t/${r.token}` })), openLink: `${base}/open` });
});
admin.post("/invites", (req, res) => {
  const list = Array.isArray(req.body?.candidates) ? req.body.candidates.slice(0, 200) : [req.body || {}];
  const ins = db.prepare("INSERT INTO invites(id, token, name, contact, role, language, lang_code, source, status, created_at) VALUES(?,?,?,?,?,?,?, 'invite', 'unused', ?)");
  const base = baseUrl(req); const out = [];
  db.transaction(() => {
    for (const c of list) {
      const token = newToken();
      ins.run(newId(), token, str(c.name, 120), str(c.contact, 160), str(c.role, 160), str(c.language, 80), str(c.langCode, 20), Date.now());
      out.push({ name: str(c.name, 120), contact: str(c.contact, 160), link: `${base}/t/${token}` });
    }
  })();
  res.json({ created: out });
});
admin.post("/invites/:id/expire", (req, res) => {
  db.prepare("UPDATE invites SET status='expired' WHERE id=? AND status IN ('unused','in_progress')").run(req.params.id);
  res.json({ ok: true });
});
admin.post("/invites/:id/reset", (req, res) => {
  // Allow a candidate to retake: issue a fresh token, clear progress (keeps earlier results).
  const token = newToken();
  db.prepare("UPDATE invites SET token=?, status='unused', started_at=NULL, completed_at=NULL, test_json=NULL, result_id=NULL WHERE id=?").run(token, req.params.id);
  res.json({ link: `${baseUrl(req)}/t/${token}` });
});
admin.delete("/invites/:id", (req, res) => { db.prepare("DELETE FROM invites WHERE id=?").run(req.params.id); res.json({ ok: true }); });

function rowToResult(r, full) {
  const x = JSON.parse(r.result_json);
  const o = {
    id: r.id, name: r.name, contact: r.contact, role: r.role, language: r.language,
    startedAt: r.started_at, finishedAt: r.finished_at, durationSec: r.duration_sec,
    tabSwitches: r.tab_switches, timeUp: !!r.time_up, listenFallback: !!r.listen_fallback,
    overall: x.overall, scores: {}, typedSpeaking: (x.speaking || []).some((s) => s.mode === "typed"),
  };
  for (const k of ["grammar", "reading", "listening", "speaking"]) {
    const v = x.scores[k] || {};
    o.scores[k] = full ? v : { cefr: v.cefr, score: v.score };
  }
  if (full) o.speaking = x.speaking;
  return o;
}
admin.get("/results", (req, res) => {
  const rows = db.prepare("SELECT * FROM results ORDER BY finished_at DESC LIMIT 5000").all();
  res.json({ results: rows.map((r) => rowToResult(r, false)) });
});
admin.get("/results.csv", (req, res) => {
  const rows = db.prepare("SELECT * FROM results ORDER BY finished_at DESC").all();
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Name", "Email/ID", "Role", "Language", "Finished (UTC)", "Duration (min)", "Overall CEFR", "Overall score", "Grammar CEFR", "Grammar score", "Reading CEFR", "Reading score", "Listening CEFR", "Listening score", "Speaking CEFR", "Speaking score", "Tab switches", "Time up", "Speaking typed", "Speaking feedback"];
  const lines = [head.map(esc).join(",")];
  for (const r of rows) {
    const x = JSON.parse(r.result_json); const sc = x.scores;
    lines.push([r.name, r.contact, r.role, r.language, new Date(r.finished_at).toISOString(), (r.duration_sec / 60).toFixed(1), r.overall_cefr, r.overall_score,
      sc.grammar.cefr, sc.grammar.score, sc.reading.cefr, sc.reading.score, sc.listening.cefr, sc.listening.score, sc.speaking.cefr, sc.speaking.score,
      r.tab_switches, r.time_up ? "yes" : "no", (x.speaking || []).some((s) => s.mode === "typed") ? "yes" : "no", sc.speaking.feedback].map(esc).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="language-assessment-results-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + lines.join("\r\n"));
});
admin.get("/results/:id", (req, res) => {
  const r = db.prepare("SELECT * FROM results WHERE id=?").get(req.params.id);
  if (!r) return res.status(404).json({ error: "Not found" });
  res.json(rowToResult(r, true));
});
admin.delete("/results/:id", (req, res) => { db.prepare("DELETE FROM results WHERE id=?").run(req.params.id); res.json({ ok: true }); });

app.use("/api/admin", admin);

app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Server error" }); });

if (!process.env.ANTHROPIC_API_KEY && process.env.MOCK_AI !== "1") console.warn("[ai] ANTHROPIC_API_KEY is not set — tests cannot be generated until it is added.");
app.listen(PORT, () => {
  console.log(`Language assessment running on port ${PORT} (model: ${ai.MODEL}${process.env.MOCK_AI === "1" ? ", MOCK AI" : ""})`);
});
