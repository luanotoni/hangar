import { $, $$, state, api, toast, busy, ago, todayKey, esc, areaColor, applyTheme, themeSeeds } from "./core.js";
import { renderHoje } from "./hoje.js";
import { renderNoite, loadSession, bindNoite } from "./noite.js";
import { renderAgenda, bindAgenda } from "./agenda.js";
import { renderTrabalho, bindTrabalho } from "./trabalho.js";
import { renderIdeias, bindIdeias, ideaOpen } from "./ideias.js";
import { renderAjustes, bindAjustes } from "./ajustes.js";
import { renderFoco, bindFoco, loadFoco } from "./foco.js";
import { bindTarefa, refreshTask, taskOpen } from "./tarefa.js";

const ALL_VIEWS = { hoje: renderHoje, noite: renderNoite, agenda: renderAgenda, trabalho: renderTrabalho, ideias: renderIdeias, foco: renderFoco, ajustes: renderAjustes };
const ORDER = ["hoje", "noite", "agenda", "trabalho", "ideias", "foco", "ajustes"];
let VIEWS = { ...ALL_VIEWS };
const LABEL = { ticktick: "TickTick", github: "GitHub", glpi: "GLPI", vault: "Vault" };

/* ---------- configuração ---------- */
async function loadConfig() {
  state.cfgInfo = await api("/api/config");
  state.cfg = state.cfgInfo.config;
  applyConfig();
}
function applyConfig() {
  const c = state.cfg;
  const on = { ticktick: c.ticktick.ativo, github: c.trabalho.ativo, glpi: c.glpi.ativo };
  for (const k of Object.keys(LABEL)) if (k !== "vault") { if (on[k]) state.src[k] ??= null; else delete state.src[k]; }
  VIEWS = Object.fromEntries(Object.entries(ALL_VIEWS).filter(([k]) =>
    !(k === "noite" && (!c.noite.ativo || !c.ticktick.ativo)) && !(k === "agenda" && !c.ticktick.ativo)
    && !(k === "trabalho" && !c.trabalho.ativo && !c.glpi.ativo) && !(k === "foco" && !c.foco?.ativo)
    && !(k !== "ajustes" && (c.aparencia?.abas_ocultas || []).includes(k))));
  applyTheme(themeSeeds(c.aparencia));
  ORDER.forEach((v) => { const a = $(`.nav a[data-view="${v}"]`); a.hidden = !VIEWS[v]; });
  let n = 0; ORDER.filter((v) => VIEWS[v]).forEach((v) => { $(`.nav a[data-view="${v}"] kbd`).textContent = ++n; });
  $$("[data-needs]").forEach((el) => { el.hidden = !on[el.dataset.needs]; });
  const vals = { ...flat(c), "noite.fimH": fmtH(c.noite.fim) };
  $$("[data-cfg]").forEach((el) => { el.textContent = vals[el.dataset.cfg] ?? ""; });
  $("#trab-sprint").textContent = c.trabalho.subtitulo;
  $$("form[data-tag-cfg]").forEach((f) => { f.dataset.tag = vals[f.dataset.tagCfg] || ""; });
  $$("select[data-areas]").forEach((s) => { s.innerHTML = c.areas.map((a) => `<option value="${esc(a.id)}">${esc(a.nome)}</option>`).join(""); });
  $$("select[data-idea-areas]").forEach((s) => { s.innerHTML = c.ideias.areas.map((a) => `<option>${esc(a)}</option>`).join(""); });
  $(".chips").innerHTML = c.ideias.focos.map((f) => `<button type="button" class="chip" data-foco="${esc(f.foco)}">${esc(f.rotulo)}</button>`).join("");
  if (!$("#foco").value) $("#foco").value = c.ideias.focos[0]?.foco || c.ideias.foco_padrao || "";
  $("#pauta-gerar").hidden = !c.claude.ativo;
  $("#ask").hidden = !c.claude.ativo;
  document.documentElement.style.setProperty("--area-default", areaColor(c.areas[0]?.id));
}
const flat = (o, pre = "") => Object.entries(o).reduce((acc, [k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? { ...acc, ...flat(v, pre + k + ".") } : { ...acc, [pre + k]: v }), {});
const fmtH = (t) => { const [h, m] = String(t || "23:00").split(":"); return `${Number(h)}h${m && m !== "00" ? m : ""}`; };
async function saveConfig(body, btn) {
  return busy(btn, async () => {
    await api("/api/config", body);
    await loadConfig(); toast("Ajustes salvos."); route(); await loadAll(true); return true;
  });
}
let followUp = null;

function render() { VIEWS[state.view]?.(); refreshTask(); renderSources(); }

function renderSources() {
  const rows = Object.entries(state.src).map(([k, p]) => {
    const st = !p ? "wait" : p.error && !p.data ? "bad" : p.error ? "warn" : p.refreshing ? "wait" : "ok";
    const txt = !p ? "lendo…" : p.refreshing ? "atualizando…" : p.error && !p.data ? "falhou" : ago(p.fetchedAt);
    return `<li class="src src-${st}" title="${esc(p?.error || "")}"><span class="dot" aria-hidden="true"></span>${LABEL[k]}<span class="src-t">${txt}</span></li>`;
  });
  rows.push(`<li class="src src-${state.vault ? "ok" : "wait"}"><span class="dot" aria-hidden="true"></span>Vault<span class="src-t">${state.vault ? "local" : "lendo…"}</span></li>`);
  $("#sources").innerHTML = rows.join("");
  const errs = Object.entries(state.src).filter(([, p]) => p?.error && !p.data).map(([k, p]) => `<p><b>${LABEL[k]}:</b> ${esc(p.error)}</p>`);
  $("#error").innerHTML = errs.join(""); $("#error").hidden = !errs.length;
}

async function loadSrc(name, force = false) {
  try { state.src[name] = await api(`/api/src/${name}${force ? "?force=1" : ""}`); }
  catch (e) { state.src[name] = { ...(state.src[name] || {}), error: e.message }; }
  render();
}
async function loadVault() {
  try { state.vault = await api("/api/vault"); } catch (e) { toast(e.message); }
  render();
}
async function loadAll(force = false) {
  await Promise.all([...Object.keys(state.src).map((k) => loadSrc(k, force)), loadVault(), loadFoco()]);
  // fonte velha: o servidor já está buscando em segundo plano; volta para pegar o resultado
  clearTimeout(followUp);
  const pending = Object.values(state.src).some((p) => p?.refreshing) || Object.values(state.vault?.jobs || {}).some((j) => j.state === "running");
  if (pending) followUp = setTimeout(() => loadAll(), 3000);
}

/* ---------- ações ---------- */
async function complete(t, btn) {
  return busy(btn, async () => { await api("/api/task/complete", t); toast("Concluída no TickTick."); await loadSrc("ticktick"); return true; });
}
async function checkin(habitId, btn) {
  return busy(btn, async () => { await api("/api/habit/checkin", { habitId }); toast("Hábito marcado."); await loadSrc("ticktick"); return true; });
}
async function postpone(t, btn, days = 1) {
  return busy(btn, async () => { await api("/api/task/postpone", { id: t.id, projectId: t.projectId, days }); toast(days === 1 ? "Empurrada um dia no TickTick." : `Empurrada ${days} dias no TickTick.`); await loadSrc("ticktick"); return true; });
}

async function update(body, btn, msg = "Salvo no TickTick.") {
  return busy(btn, async () => { await api("/api/task/update", body); toast(msg); await loadSrc("ticktick"); return true; });
}

function route() {
  const raw = location.hash.slice(1) || (state.cfgInfo && !state.cfgInfo.exists ? "ajustes" : "hoje");
  const v = raw === "sessao" ? "noite" : raw;
  state.view = VIEWS[v] ? v : ORDER.find((x) => VIEWS[x]);
  $$(".view").forEach((el) => { el.hidden = el.dataset.view !== state.view; });
  if (state.view !== "ajustes" && state.cfg) applyTheme(themeSeeds(state.cfg.aparencia), false); // prévia não salva some
  $$(".nav a").forEach((a) => { if (a.dataset.view === state.view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  state.baseTitle = state.view === "hoje" ? "Hangar" : `${$(`.nav a[data-view="${state.view}"] span`).textContent} · Hangar`;
  document.title = state.baseTitle;
  render();
}

function bind() {
  $("#sync-btn").addEventListener("click", (e) => busy(e.currentTarget, () => loadAll(true)));
  $("#pauta-gerar").addEventListener("click", (e) => busy(e.currentTarget, async () => {
    await api("/api/pauta/gerar", {}); toast("Gerando a pauta… leva uns 10 segundos."); await loadAll();
  }));
  $("#pauta").addEventListener("change", (e) => {
    const box = e.target.closest("input[data-box]"); if (!box) return;
    box.closest("li").classList.toggle("is-on", box.checked);
    api("/api/pauta/toggle", { index: Number(box.dataset.box) }).catch((err) => { toast(err.message); box.checked = !box.checked; });
  });
  document.addEventListener("submit", async (e) => {
    const f = e.target.closest("form[data-add]"); if (!f) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f)); if (f.dataset.tag) data.tag = f.dataset.tag;
    const btn = f.querySelector("button[type=submit]");
    await busy(btn, async () => {
      await api(f.dataset.add === "ideia" ? "/api/ideia/add" : "/api/pendencia/add", data);
      f.reset(); toast(f.dataset.add === "ideia" ? "Ideia guardada no vault." : "Anotada no vault."); await loadVault();
      f.querySelector("input")?.focus();
    });
  });
  document.addEventListener("change", (e) => {
    if (e.target.dataset.act !== "pend-toggle") return;
    const id = e.target.closest("[data-pend]").dataset.pend;
    api("/api/pendencia/toggle", { id }).then(loadVault).catch((err) => { toast(err.message); loadVault(); });
  });
  $("#hoje-vence").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act=complete]"); if (!b) return;
    const t = state.src.ticktick.data.tasks.find((x) => x.id === b.closest("[data-task]").dataset.task);
    complete({ id: t.id, projectId: t.projectId }, b);
  });
  bindTarefa({ complete, postpone, update, changed: () => VIEWS[state.view]?.() });
  bindNoite({ complete, checkin, postpone });
  bindAgenda({ complete, postpone });
  bindTrabalho();
  bindAjustes({ save: saveConfig });
  bindFoco();
  bindIdeias({
    ask: (foco, btn) => busy(btn, async () => { await api("/api/ideias/gerar", { foco }); await loadAll(); }),
    reload: loadVault,
  });
  document.addEventListener("keydown", (e) => {
    if (taskOpen() || ideaOpen() || e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input, textarea, select")) return;
    const views = ORDER.filter((v) => VIEWS[v]);
    if (/^[1-9]$/.test(e.key) && views[Number(e.key) - 1]) { location.hash = views[Number(e.key) - 1]; }
    else if (e.key === "r" || e.key === "R") { $("#sync-btn").click(); }
    else if ((e.key === "n" || e.key === "N") && VIEWS.hoje) { e.preventDefault(); if (state.view !== "hoje") location.hash = "hoje"; route(); $("#pend-new").focus(); }
  });
  window.addEventListener("hashchange", route);
  window.addEventListener("resize", () => state.view === "noite" && renderNoite());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadAll(); });
}

(async function init() {
  try { await loadConfig(); } catch (e) { toast(e.message); }
  bind();
  await loadSession();
  route();
  await loadAll();
  setInterval(() => {
    if (state.session.date !== todayKey()) loadSession().then(render);
    else if (state.view === "noite") renderNoite();
    renderSources();
  }, 30000);
  setInterval(() => { if (!document.hidden) loadAll(); }, 3 * 60000);
})();
