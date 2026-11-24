"use strict";
const crypto = require("crypto");

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./db");
// Use SESSION_SECRET if provided; otherwise create one once and keep it in the data folder.
function loadSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, ".session_secret");
  try { const v = fs.readFileSync(f, "utf8").trim(); if (v.length >= 32) return v; } catch { /* create below */ }
  const v = crypto.randomBytes(32).toString("hex");
  try { fs.writeFileSync(f, v, { mode: 0o600 }); } catch (e) { console.warn("[auth] could not save session secret:", e.message); }
  return v;
}
const SECRET = loadSecret();
const PASSWORD = process.env.RECRUITER_PASSWORD || "";
const COOKIE = "la_admin";
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SECURE = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";

if (!PASSWORD) console.warn("[auth] RECRUITER_PASSWORD is not set — the recruiter dashboard is locked.");

function sign(v) { return crypto.createHmac("sha256", SECRET).update(v).digest("base64url"); }
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function checkPassword(pw) {
  if (!PASSWORD) return false;
  // hash both sides so length differences don't leak
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(pw), h(PASSWORD));
}
function issue(res) {
  const exp = Date.now() + TTL_MS;
  const val = `${exp}.${sign("admin:" + exp)}`;
  res.cookie(COOKIE, val, { httpOnly: true, sameSite: "lax", secure: SECURE, maxAge: TTL_MS, path: "/" });
}
function clear(res) { res.clearCookie(COOKIE, { path: "/" }); }
function isAdmin(req) {
  const v = req.cookies && req.cookies[COOKIE];
  if (!v) return false;
  const [exp, sig] = String(v).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEq(sig, sign("admin:" + exp));
}
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: "Not signed in" });
}

/* tiny in-memory rate limiter */
const buckets = new Map();
function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  return (req, res, next) => {
    const k = key(req) + ":" + req.route?.path;
    const now = Date.now();
    const b = buckets.get(k) || { n: 0, reset: now + windowMs };
    if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
    b.n++; buckets.set(k, b);
    if (b.n > max) return res.status(429).json({ error: "Too many requests — please wait and try again." });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60000).unref();

module.exports = { checkPassword, issue, clear, isAdmin, requireAdmin, rateLimit };
