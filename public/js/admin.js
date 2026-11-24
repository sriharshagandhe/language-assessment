"use strict";
let tab = "results";
let settings = null;
let results = [], filter = { q: "", lang: "" };

(async function boot() {
  const me = await api("GET", "/api/admin/me").catch(() => ({ admin: false }));
  if (!me.admin) return renderLogin();
  await loadSettings(); show("results");
})();

function renderLogin() {
  document.getElementById("tabs").replaceChildren();
  const pw = h("input", { type: "password", placeholder: "Recruiter password", autocomplete: "current-password" });
  const err = h("div", { class: "notice warn hidden" });
  const go = async (e) => {
    e.preventDefault();
    try { await api("POST", "/api/admin/login", { password: pw.value }); await loadSettings(); show("results"); }
    catch (x) { err.textContent = x.message; err.classList.remove("hidden"); }
  };
  mount(h("form", { class: "card login", onsubmit: go }, h("h2", {}, "Recruiter sign in"), h("label", {}, "Password"), pw, err,
    h("div", { class: "row", style: "margin-top:16px" }, h("div", { class: "spacer" }), h("button", { class: "primary", type: "submit" }, "Sign in"))));
  pw.focus();
}
async function loadSettings() { settings = await api("GET", "/api/admin/settings"); }

function setTabs() {
  const t = document.getElementById("tabs");
  t.replaceChildren(
    ...[["results", "Results"], ["invites", "Invite candidates"], ["settings", "Settings"]].map(([k, n]) => h("button", { class: "tab" + (tab === k ? " on" : ""), onclick: () => show(k) }, n)),
    h("button", { class: "tab", onclick: async () => { await api("POST", "/api/admin/logout"); renderLogin(); } }, "Sign out"));
}
function show(k) { tab = k; setTabs(); ({ results: renderResults, invites: renderInvites, settings: renderSettings })[k](); }
function handleAuth(e) { if (e.status === 401) { renderLogin(); return true; } return false; }

/* ============================== RESULTS ============================== */
async function renderResults() {
  mount(h("div", { class: "card center" }, h("div", { class: "spinner" })));
  try { results = (await api("GET", "/api/admin/results")).results; } catch (e) { if (handleAuth(e)) return; return mount(h("div", { class: "card" }, e.message)); }
  const stats = h("div", { class: "skills", style: "margin-top:0" });
  const tableHost = h("div", { class: "tablewrap" });
  const search = h("input", { type: "text", placeholder: "Search name, email, role…", value: filter.q, style: "max-width:280px" });
  search.addEventListener("input", () => { filter.q = search.value; draw(); });
  const langF = h("select", { style: "max-width:220px" }); langF.addEventListener("change", () => { filter.lang = langF.value; draw(); });

  function draw() {
    const langs = [...new Set(results.map((r) => r.language))].sort();
    langF.replaceChildren(h("option", { value: "" }, "All languages"), langs.map((l) => h("option", { value: l, selected: filter.lang === l }, l)));
    const q = filter.q.toLowerCase();
    const rows = results.filter((r) => (!filter.lang || r.language === filter.lang) && (!q || [r.name, r.contact, r.role, r.language].join(" ").toLowerCase().includes(q)));
    const n = rows.length, avg = n ? Math.round(rows.reduce((a, r) => a + (r.overall?.score || 0), 0) / n) : 0;
    const b2 = rows.filter((r) => ["B2", "C1", "C2"].includes(r.overall?.cefr)).length;
    const toCEFR = (s) => s < 15 ? "Pre-A1" : s < 30 ? "A1" : s < 45 ? "A2" : s < 60 ? "B1" : s < 75 ? "B2" : s < 90 ? "C1" : "C2";
    stats.replaceChildren(...[["Assessments", n], ["Languages", new Set(rows.map((r) => r.language)).size], ["Average level", n ? toCEFR(avg) : "—"], ["B2 or above", n ? `${b2} (${Math.round(b2 / n * 100)}%)` : "—"]]
      .map(([a, b]) => h("div", { class: "skill" }, h("div", { class: "name" }, a), h("div", { class: "val" }, String(b)))));
    if (!rows.length) return tableHost.replaceChildren(h("p", { class: "muted center", style: "padding:30px" }, results.length ? "No results match the filters." : "No assessments yet. Create invite links in the \"Invite candidates\" tab."));
    tableHost.replaceChildren(h("table", {},
      h("thead", {}, h("tr", {}, ["Candidate", "Role", "Language", "Date", "Overall", "Grammar", "Reading", "Listening", "Speaking", "Flags"].map((t) => h("th", {}, t)))),
      h("tbody", {}, rows.map((r) => {
        const f = []; if (r.tabSwitches) f.push(`${r.tabSwitches} tab switch${r.tabSwitches > 1 ? "es" : ""}`); if (r.timeUp) f.push("time up"); if (r.listenFallback) f.push("listening as text"); if (r.typedSpeaking) f.push("speaking typed");
        return h("tr", { class: "clickable", onclick: () => openDetail(r.id) },
          h("td", {}, h("div", { style: "font-weight:600" }, r.name || "—"), h("div", { class: "muted", style: "font-size:12px" }, r.contact || "")),
          h("td", {}, r.role || ""), h("td", {}, r.language), h("td", { style: "white-space:nowrap" }, fmtDate(r.finishedAt)),
          h("td", {}, h("span", { class: "lvl" }, r.overall?.cefr || "—"), " ", h("span", { class: "muted", style: "font-size:12px" }, r.overall?.score ?? "")),
          ["grammar", "reading", "listening", "speaking"].map((k) => h("td", {}, r.scores?.[k]?.cefr || "—")),
          h("td", { style: "font-size:12px;color:var(--warn)" }, f.join(", ")));
      }))));
  }
  mount(
    h("div", { class: "row", style: "margin-bottom:14px" }, h("h2", { style: "margin:0" }, "Results"), h("div", { class: "spacer" }),
      h("button", { onclick: renderResults }, "Refresh")),
    stats,
    h("div", { class: "card", style: "margin-top:14px" },
      h("div", { class: "row", style: "margin-bottom:12px" }, search, langF, h("div", { class: "spacer" }), h("a", { href: "/api/admin/results.csv" }, h("button", {}, "Download CSV"))),
      tableHost));
  draw();
}

async function openDetail(id) {
  const root = document.getElementById("modal-root"); const close = () => root.replaceChildren();
  let r; try { r = await api("GET", "/api/admin/results/" + id); } catch (e) { if (!handleAuth(e)) alertBox(e.message); return; }
  const sp = r.scores.speaking || {}; const crit = sp.criteria || {};
  const del = h("button", { class: "danger" }, "Delete this result"); let armed = false;
  del.addEventListener("click", async () => { if (!armed) { armed = true; del.textContent = "Click again to confirm"; return; } await api("DELETE", "/api/admin/results/" + id); close(); renderResults(); });
  root.replaceChildren(h("div", { class: "overlay", onclick: (e) => { if (e.target.classList.contains("overlay")) close(); } },
    h("div", { class: "modal" },
      h("div", { class: "row" }, h("h2", { style: "margin:0" }, r.name || "Candidate"), h("span", { class: "pill" }, r.language), h("div", { class: "spacer" }), h("button", { onclick: close }, "Close")),
      h("div", { class: "kv", style: "margin:14px 0" },
        h("div", {}, "Email / ID"), h("div", {}, r.contact || "—"), h("div", {}, "Role"), h("div", {}, r.role || "—"),
        h("div", {}, "Completed"), h("div", {}, `${fmtDate(r.finishedAt)} · ${fmtDur(r.durationSec || 0)} min` + (r.timeUp ? " · time limit reached" : "")),
        h("div", {}, "Integrity"), h("div", {}, `${r.tabSwitches || 0} tab switch${r.tabSwitches === 1 ? "" : "es"}` + (r.listenFallback ? " · listening shown as text" : ""))),
      h("div", { class: "row", style: "align-items:flex-end" },
        h("div", {}, h("div", { class: "muted", style: "font-size:13px;font-weight:600" }, "Overall"), h("div", { class: "big-lvl" }, r.overall.cefr)),
        h("div", { class: "muted" }, `${r.overall.score}/100 — ${CEFR_DESC[r.overall.cefr] || ""}`)),
      skillTiles(r.scores),
      h("h3", { style: "margin-top:20px" }, "Speaking evaluation"),
      Object.keys(crit).length > 0 && h("div", { class: "row", style: "gap:18px;font-size:14px;margin-bottom:8px" }, Object.entries(crit).map(([k, v]) => h("span", {}, h("span", { class: "muted" }, k[0].toUpperCase() + k.slice(1) + ": "), h("b", {}, String(v))))),
      h("p", {}, sp.feedback || ""),
      (r.speaking || []).map((s, i) => h("div", { class: "q" },
        h("div", { class: "stem" }, h("span", { class: "tag" }, s.level), s.prompt),
        s.prompt_en && h("div", { class: "muted", style: "font-size:13px" }, "EN: " + s.prompt_en),
        h("div", { class: "transcript" }, s.response || "(no response)"),
        h("div", { class: "muted", style: "font-size:12px;margin-top:4px" }, (s.mode === "typed" ? "Typed" : "Spoken" + (s.seconds ? ` · ${fmtDur(s.seconds)}` : "")) + (sp.perPrompt?.[i] ? ` · ${sp.perPrompt[i].cefr} — ${sp.perPrompt[i].comment}` : "")))),
      h("div", { class: "row", style: "margin-top:16px" }, h("div", { class: "spacer" }), del))));
}
function alertBox(msg) {
  const root = document.getElementById("modal-root");
  root.replaceChildren(h("div", { class: "overlay", onclick: () => root.replaceChildren() }, h("div", { class: "modal" }, h("p", {}, msg), h("button", {}, "OK"))));
}

/* ============================== INVITES ============================== */
async function renderInvites() {
  mount(h("div", { class: "card center" }, h("div", { class: "spinner" })));
  let data; try { data = await api("GET", "/api/admin/invites"); } catch (e) { if (handleAuth(e)) return; return mount(h("div", { class: "card" }, e.message)); }

  const nameI = h("input", { type: "text", placeholder: "Candidate name (optional)" });
  const contactI = h("input", { type: "text", placeholder: "Email or ID (optional)" });
  const roleI = h("input", { type: "text", placeholder: "Role (optional)" });
  const ls = langSelect("");
  const bulk = h("textarea", { placeholder: "One candidate per line:  Name, email, role, language\nPriya Shah, priya@example.com, Support – German, German\nLuis Gómez, luis@example.com, Sales, Spanish (Latin America)" });
  const out = h("div", {});

  function showCreated(list) {
    const text = list.map((c) => [c.name, c.contact, c.link].filter(Boolean).join(" — ")).join("\n");
    const ta = h("textarea", { readOnly: true, value: text, style: "min-height:" + Math.min(300, 40 + list.length * 22) + "px;font-size:13px" });
    const copy = h("button", { onclick: () => navigator.clipboard.writeText(text).then(() => { copy.textContent = "Copied ✓"; }, () => { ta.select(); }) }, "Copy all");
    out.replaceChildren(h("div", { class: "notice" }, `${list.length} invite link${list.length > 1 ? "s" : ""} created. Send each candidate their own link — each works once.`), ta, h("div", { class: "row", style: "margin-top:8px" }, copy));
  }
  async function createOne() {
    const lang = ls.get();
    const r = await api("POST", "/api/admin/invites", { name: nameI.value, contact: contactI.value, role: roleI.value, language: lang.name, langCode: lang.code });
    showCreated(r.created); nameI.value = contactI.value = roleI.value = ""; refreshList();
  }
  async function createBulk() {
    const cands = bulk.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, contact, role, language] = l.split(/\s*[,\t;]\s*/);
      const f = LANGS.find((x) => x[0].toLowerCase() === (language || "").toLowerCase()) || LANGS.find((x) => x[0].toLowerCase().startsWith((language || "~").toLowerCase()));
      return { name, contact, role, language: f ? f[0] : (language || ""), langCode: f ? f[1] : "" };
    });
    if (!cands.length) return;
    const r = await api("POST", "/api/admin/invites", { candidates: cands }); showCreated(r.created); bulk.value = ""; refreshList();
  }

  const listHost = h("div", { class: "tablewrap" });
  function drawList(invites) {
    if (!invites.length) return listHost.replaceChildren(h("p", { class: "muted center", style: "padding:20px" }, "No invites yet."));
    listHost.replaceChildren(h("table", {},
      h("thead", {}, h("tr", {}, ["Candidate", "Language", "Created", "Status", "Link", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, invites.map((v) => {
        const copyBtn = h("button", { onclick: () => navigator.clipboard.writeText(v.link).then(() => { copyBtn.textContent = "Copied ✓"; setTimeout(() => copyBtn.textContent = "Copy link", 1500); }) }, "Copy link");
        const actions = h("div", { class: "row", style: "gap:6px;flex-wrap:nowrap" });
        if (v.status === "unused" || v.status === "in_progress") actions.append(h("button", { onclick: async () => { await api("POST", `/api/admin/invites/${v.id}/expire`); refreshList(); } }, "Expire"));
        if (v.status !== "unused") actions.append(h("button", { title: "Issue a fresh link so the candidate can retake", onclick: async () => { await api("POST", `/api/admin/invites/${v.id}/reset`); refreshList(); } }, "Allow retake"));
        return h("tr", {},
          h("td", {}, h("div", { style: "font-weight:600" }, v.name || (v.source === "open" ? "(open link)" : "—")), h("div", { class: "muted", style: "font-size:12px" }, [v.contact, v.role].filter(Boolean).join(" · "))),
          h("td", {}, v.language || h("span", { class: "muted" }, "candidate chooses")),
          h("td", { style: "white-space:nowrap" }, fmtDate(v.created_at)),
          h("td", {}, h("span", { class: "status " + v.status }, v.status.replace("_", " "))),
          h("td", {}, v.status === "completed" || v.status === "expired" ? "" : copyBtn),
          h("td", {}, actions));
      }))));
  }
  async function refreshList() { try { const d = await api("GET", "/api/admin/invites"); drawList(d.invites); } catch (e) { handleAuth(e); } }

  mount(
    h("h2", { style: "margin:0 0 14px" }, "Invite candidates"),
    h("div", { class: "grid2" },
      h("div", { class: "card" }, h("h3", {}, "Single invite"),
        nameI, h("div", { style: "height:8px" }), contactI, h("div", { style: "height:8px" }), roleI,
        h("label", {}, "Language (leave blank to let the candidate choose)"), ls.nodes,
        h("div", { class: "row", style: "margin-top:14px" }, h("div", { class: "spacer" }), h("button", { class: "primary", onclick: createOne }, "Create link"))),
      h("div", { class: "card" }, h("h3", {}, "Bulk invites"), bulk,
        h("div", { class: "row", style: "margin-top:14px" }, h("span", { class: "muted", style: "font-size:12px" }, "Language must match the list name, or leave it blank."), h("div", { class: "spacer" }), h("button", { class: "primary", onclick: createBulk }, "Create links")))),
    out,
    settings.allowOpenLink && h("div", { class: "card" }, h("h3", {}, "Open link (anyone with it can take the test)"),
      h("div", { class: "linkbox" }, h("input", { type: "text", readOnly: true, value: data.openLink }), h("button", { onclick: () => navigator.clipboard.writeText(data.openLink) }, "Copy"))),
    h("div", { class: "card" }, h("h3", {}, "All invites"), listHost));
  drawList(data.invites);
}

/* ============================== SETTINGS ============================== */
function renderSettings() {
  const org = h("input", { type: "text", value: settings.orgName || "", placeholder: "e.g. MediaMint" });
  const tl = h("select", { style: "width:auto" }, [20, 30, 40, 50, 60, 90].map((m) => h("option", { value: m, selected: settings.timeLimitMin === m }, m + " minutes")));
  const show = h("input", { type: "checkbox", checked: settings.showResults });
  const open = h("input", { type: "checkbox", checked: settings.allowOpenLink });
  const msg = h("span", { class: "muted", style: "font-size:13px" });
  const save = async () => {
    try { settings = await api("PUT", "/api/admin/settings", { orgName: org.value, timeLimitMin: Number(tl.value), showResults: show.checked, allowOpenLink: open.checked }); msg.textContent = "Saved ✓"; setTimeout(() => msg.textContent = "", 1500); }
    catch (e) { if (!handleAuth(e)) msg.textContent = e.message; }
  };
  mount(h("h2", { style: "margin:0 0 14px" }, "Settings"),
    h("div", { class: "card", style: "max-width:640px" },
      h("label", {}, "Organisation name (shown to candidates)"), org,
      h("label", {}, "Time limit"), tl,
      h("label", { class: "toggle", style: "margin-top:16px" }, show, "Show the score report to candidates after they submit"),
      h("label", { class: "toggle", style: "margin-top:10px" }, open, "Enable a shared open link (anyone with it can take the test; personal invites are more secure)"),
      h("div", { class: "row", style: "margin-top:18px" }, msg, h("div", { class: "spacer" }), h("button", { class: "primary", onclick: save }, "Save settings"))));
}
