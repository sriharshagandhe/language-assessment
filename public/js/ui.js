"use strict";
/* Shared UI helpers — all dynamic text is inserted as text nodes (never innerHTML). */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.setAttribute("style", v);
    else if (k in el && k !== "list") { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const $app = () => document.getElementById("app");
function mount(...nodes) { $app().replaceChildren(...nodes.flat(Infinity).filter((n) => n != null && n !== false)); window.scrollTo(0, 0); }
function fmtDur(s) { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m + ":" + String(s % 60).padStart(2, "0"); }
function fmtDate(ts) { try { return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return ""; } }
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) { const e = new Error((data && data.error) || `Request failed (${r.status})`); e.status = r.status; throw e; }
  return data;
}

const LANGS = [
  ["Afrikaans", "af-ZA"], ["Albanian", "sq-AL"], ["Amharic", "am-ET"], ["Arabic", "ar-SA"], ["Armenian", "hy-AM"], ["Assamese", "as-IN"], ["Azerbaijani", "az-AZ"],
  ["Basque", "eu-ES"], ["Belarusian", "be-BY"], ["Bengali", "bn-IN"], ["Bosnian", "bs-BA"], ["Bulgarian", "bg-BG"], ["Burmese", "my-MM"], ["Catalan", "ca-ES"],
  ["Chinese (Mandarin, Simplified)", "zh-CN"], ["Chinese (Traditional)", "zh-TW"], ["Cantonese", "yue-HK"], ["Croatian", "hr-HR"], ["Czech", "cs-CZ"],
  ["Danish", "da-DK"], ["Dutch", "nl-NL"], ["English", "en-US"], ["Estonian", "et-EE"], ["Filipino / Tagalog", "fil-PH"], ["Finnish", "fi-FI"], ["French", "fr-FR"],
  ["Galician", "gl-ES"], ["Georgian", "ka-GE"], ["German", "de-DE"], ["Greek", "el-GR"], ["Gujarati", "gu-IN"], ["Hausa", "ha-NG"], ["Hebrew", "he-IL"], ["Hindi", "hi-IN"],
  ["Hungarian", "hu-HU"], ["Icelandic", "is-IS"], ["Igbo", "ig-NG"], ["Indonesian", "id-ID"], ["Irish", "ga-IE"], ["Italian", "it-IT"], ["Japanese", "ja-JP"],
  ["Kannada", "kn-IN"], ["Kazakh", "kk-KZ"], ["Khmer", "km-KH"], ["Korean", "ko-KR"], ["Kurdish", "ku"], ["Kyrgyz", "ky-KG"], ["Lao", "lo-LA"], ["Latvian", "lv-LV"],
  ["Lithuanian", "lt-LT"], ["Macedonian", "mk-MK"], ["Malay", "ms-MY"], ["Malayalam", "ml-IN"], ["Maltese", "mt-MT"], ["Marathi", "mr-IN"], ["Mongolian", "mn-MN"],
  ["Nepali", "ne-NP"], ["Norwegian", "nb-NO"], ["Odia", "or-IN"], ["Pashto", "ps-AF"], ["Persian (Farsi)", "fa-IR"], ["Polish", "pl-PL"], ["Portuguese (Brazil)", "pt-BR"],
  ["Portuguese (Portugal)", "pt-PT"], ["Punjabi", "pa-IN"], ["Romanian", "ro-RO"], ["Russian", "ru-RU"], ["Serbian", "sr-RS"], ["Sinhala", "si-LK"], ["Slovak", "sk-SK"],
  ["Slovenian", "sl-SI"], ["Somali", "so-SO"], ["Spanish (Spain)", "es-ES"], ["Spanish (Latin America)", "es-MX"], ["Swahili", "sw-KE"], ["Swedish", "sv-SE"],
  ["Tamil", "ta-IN"], ["Telugu", "te-IN"], ["Thai", "th-TH"], ["Turkish", "tr-TR"], ["Ukrainian", "uk-UA"], ["Urdu", "ur-PK"], ["Uzbek", "uz-UZ"], ["Vietnamese", "vi-VN"],
  ["Welsh", "cy-GB"], ["Xhosa", "xh-ZA"], ["Yoruba", "yo-NG"], ["Zulu", "zu-ZA"],
];
const CEFR_DESC = {
  "Pre-A1": "Very limited — recognises isolated words only.",
  A1: "Beginner — understands and uses familiar everyday expressions.",
  A2: "Elementary — handles simple, routine exchanges on familiar topics.",
  B1: "Intermediate — deals with most everyday situations; describes experiences and plans.",
  B2: "Upper-intermediate — interacts with fluency and spontaneity; clear, detailed text.",
  C1: "Advanced — flexible, effective use for social, academic and professional purposes.",
  C2: "Proficient — near-native; understands virtually everything with ease.",
};
function langSelect(selectedName) {
  const sel = h("select", {},
    h("option", { value: "" }, "Select a language…"),
    LANGS.map(([n, c]) => h("option", { value: c, selected: n === selectedName }, n)),
    h("option", { value: "__other" }, "Other (type it)…"));
  const other = h("input", { type: "text", placeholder: "Type the language name, e.g. Tulu, Konkani, Quechua", class: "hidden" });
  sel.addEventListener("change", () => other.classList.toggle("hidden", sel.value !== "__other"));
  return {
    nodes: [sel, other],
    get() {
      if (sel.value === "__other") return { name: other.value.trim(), code: "" };
      const f = LANGS.find((l) => l[1] === sel.value); return f ? { name: f[0], code: f[1] } : { name: "", code: "" };
    },
  };
}
function skillTiles(sc) {
  const rows = [["Grammar & vocab", sc.grammar], ["Reading", sc.reading], ["Listening", sc.listening], ["Speaking", sc.speaking]];
  return h("div", { class: "skills" }, rows.map(([n, s]) => h("div", { class: "skill" },
    h("div", { class: "name" }, n),
    h("div", { class: "row", style: "gap:8px;margin-top:4px" }, h("span", { class: "val" }, (s && s.cefr) || "—"), h("span", { class: "muted", style: "font-size:13px" }, s && s.score != null ? s.score + "/100" : "")),
    h("div", { class: "bar" }, h("i", { style: `width:${(s && s.score) || 0}%` })),
    s && s.total != null && h("div", { class: "muted", style: "font-size:12px;margin-top:4px" }, `${s.correct}/${s.total} correct`))));
}
