// Estado, API e utilitários compartilhados pelas visões.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const state = {
  view: "hoje",
  src: {},
  cfg: null, cfgInfo: null,
  vault: null,
  session: null,
  agenda: { scale: "semana", ref: new Date(), selDay: null },
};

/* ---------- datas ---------- */
export const WD = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const WDS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const AG = new URLSearchParams(location.search).get("agora") || "";
export const AGORA = /^\d{2}:\d{2}$/.test(AG) ? AG : null;
export const nowDate = () => { const d = new Date(); if (AGORA) { const [h, m] = AGORA.split(":").map(Number); d.setHours(h, m, 0, 0); } return d; };
export const todayKey = () => dayKey(new Date());
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfWeek = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export const parseHM = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
export const fmtDur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) : ""}` : `${m} min`);
export const shortDate = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
export function ago(iso) {
  if (!iso) return "nunca";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} d`;
}
export const daysSince = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

/* ---------- TickTick ---------- */
export const tt = () => state.src.ticktick?.data || null;
export function taskDay(t) { const v = t.start || t.due; return v ? dayKey(new Date(v)) : null; }
export function isLate(t) {
  if (!t.due || t.done) return false;
  const due = new Date(t.due);
  return t.allDay ? dayKey(due) < todayKey() : due < new Date();
}
export const taskTime = (t) => (t.allDay || !t.start ? null : hm(new Date(t.start)));
export function projectInfo(id) {
  const ps = tt()?.projects || [];
  const i = ps.findIndex((p) => p.id === id);
  const name = (i >= 0 ? ps[i].name : "").replace(/^(\p{Extended_Pictographic}️?)(?=\S)/u, "$1 ");
  return { name, color: `var(--list-${(Math.max(i, 1) - 1) % 5 + 1})` };
}
export const taskById = (id) => tt()?.tasks.find((t) => t.id === id);
export function candidates() {
  const tasks = (tt()?.tasks || []).filter((t) => !t.done);
  const today = todayKey(); const tomorrow = dayKey(addDays(new Date(), 1));
  const by = (a, b) => (b.priority - a.priority) || ((a.due || "") < (b.due || "") ? -1 : 1);
  const late = tasks.filter((t) => isLate(t) && taskDay(t) !== today).sort(by);
  const now = tasks.filter((t) => taskDay(t) === today && !late.includes(t)).sort(by);
  const next = tasks.filter((t) => taskDay(t) === tomorrow).sort(by);
  return { late, now, next };
}

/* ---------- configuração ---------- */
export const cfg = () => state.cfg;

/* ---------- tema ---------- */
// Cores-semente de cada tema; tokens.css deriva o resto (luminosidade fixa, croma com teto).
export const TEMAS = {
  cabine: { nome: "Cabine", fundo: "#09183b", estrutura: "#549de5", destaque: "#f98f2b" },
  grafite: { nome: "Grafite", fundo: "#1b1b1b", estrutura: "#98adc4", destaque: "#e7b643" },
  floresta: { nome: "Floresta", fundo: "#002313", estrutura: "#51bb9a", destaque: "#d8c65a" },
  oceano: { nome: "Oceano", fundo: "#001f2f", estrutura: "#4fbec4", destaque: "#fc8e72" },
  ameixa: { nome: "Ameixa", fundo: "#26102c", estrutura: "#a998dd", destaque: "#f98e8f" },
  brasa: { nome: "Brasa", fundo: "#2a140c", estrutura: "#ca9971", destaque: "#fd7562" },
};
const HEX = /^#[0-9a-f]{6}$/i;
/** As três sementes efetivas: as cores salvas quando válidas, senão as do tema (ou do Cabine). */
export function themeSeeds(a = {}) {
  const base = TEMAS[a.tema] || TEMAS.cabine;
  const pick = (k) => (a.tema === "personalizado" && HEX.test(a[k] || "") ? a[k] : base[k]);
  return { fundo: pick("fundo"), estrutura: pick("estrutura"), destaque: pick("destaque") };
}
/** Aplica as sementes na página e guarda no navegador para a próxima abertura não piscar. */
export function applyTheme(seeds, persist = true) {
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries(seeds)) r.setProperty(`--seed-${k}`, v);
  if (persist) try { localStorage.setItem("hangar-tema", JSON.stringify(seeds)); } catch { /* sem storage: só pisca */ }
  themeFavicon();
}
/** Favicon da logo nas cores calculadas do tema ativo (estrutura + destaque); logo.svg fica com as do Cabine. */
function themeFavicon() {
  const link = document.querySelector('link[rel="icon"]');
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!link || !ctx) return;
  const probe = document.documentElement.appendChild(document.createElement("i"));
  const hex = (token) => {
    probe.style.color = `var(${token})`;
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = getComputedStyle(probe).color; ctx.fillRect(0, 0, 1, 1);
    return "#" + [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((n) => n.toString(16).padStart(2, "0")).join("");
  };
  const [field, accent] = [hex("--color-field"), hex("--color-accent")];
  probe.remove();
  const nave = "M32 21 42 50 32 45 22 50Z";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><mask id="h"><path fill="#fff" d="M0 0h64v64H0z"/><path d="${nave}" stroke="#000" stroke-width="6" stroke-linejoin="round"/></mask><path mask="url(#h)" fill="${field}" fill-rule="evenodd" d="M4 56V38a28 28 0 0 1 56 0v18ZM19 56V42a13 13 0 0 1 26 0v14Z"/><path fill="${accent}" d="${nave}"/></svg>`;
  link.href = "data:image/svg+xml," + encodeURIComponent(svg);
}
export function areaColor(id) {
  const i = (state.cfg?.areas || []).findIndex((a) => a.id === id);
  return i < 0 ? "var(--color-ink-2)" : `var(--list-${(i % 5) + 1})`;
}
export function shortRepo(name) {
  for (const p of state.cfg?.trabalho?.prefixos_repo || []) if (p && name.startsWith(p)) return name.slice(p.length);
  return name;
}

/* ---------- API ---------- */
export async function api(path, body) {
  const opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Hangar": "1" }, body: JSON.stringify(body) };
  let r;
  try { r = await fetch(path, opt); } catch { throw new Error("O servidor do Hangar não respondeu. Rode o comando hangar de novo."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Falhou (${r.status}).`);
  return j;
}

/* ---------- UI ---------- */
export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3400);
}
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export async function busy(btn, fn) {
  if (btn) { btn.setAttribute("aria-busy", "true"); btn.disabled = true; }
  try { return await fn(); } catch (e) { toast(e.message); return undefined; } finally { if (btn && btn.isConnected) { btn.removeAttribute("aria-busy"); btn.disabled = false; } }
}
export const icon = {
  up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 10 5-5 5 5"/></svg>',
  down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 6 5 5 5-5"/></svg>',
  left: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>',
  right: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg>',
  x: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>',
  later: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h10M8.5 4.5 12 8l-3.5 3.5M14 3v10"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.5 3.2 3L13 4.5"/></svg>',
  ext: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7 9"/></svg>',
  eye: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/></svg>',
};

/* ---------- preferências locais (só conveniência) ---------- */
export function pref(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem("hangar:" + key) || "null");
    localStorage.setItem("hangar:" + key, JSON.stringify(val));
  } catch { /* sem storage: segue sem lembrar */ }
  return val;
}

/* ---------- markdown mínimo (pauta e ideias) ---------- */
function inline(s) {
  return esc(s)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "<span class=\"wl\">$2</span>")
    .replace(/\[\[([^\]]+)\]\]/g, "<span class=\"wl\">$1</span>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}
export function md(text, { checkable = false } = {}) {
  const out = []; let list = null; let box = -1; let para = [];
  const flushP = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const closeL = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushP(); closeL(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushP(); closeL(); const lv = Math.min(4, m[1].length + 1); out.push(`<h${lv}>${inline(m[2])}</h${lv}>`); continue; }
    if ((m = line.match(/^\s*-\s+\[( |x)\]\s+(.*)$/))) {
      flushP(); if (list !== "ul") { closeL(); out.push('<ul class="md-list">'); list = "ul"; }
      box += 1; const on = m[1] === "x";
      out.push(checkable
        ? `<li class="md-check${on ? " is-on" : ""}"><label><input type="checkbox" data-box="${box}"${on ? " checked" : ""}><span>${inline(m[2])}</span></label></li>`
        : `<li class="md-check${on ? " is-on" : ""}"><span>${inline(m[2])}</span></li>`);
      continue;
    }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { flushP(); if (list !== "ul") { closeL(); out.push('<ul class="md-list">'); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { flushP(); if (list !== "ol") { closeL(); out.push('<ol class="md-list">'); list = "ol"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    closeL(); para.push(line.trim());
  }
  flushP(); closeL();
  return out.join("");
}
