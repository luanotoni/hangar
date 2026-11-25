// Aba Ideias: quadro por estágio, filtros, painel de detalhes com edição, observações, fechar (card pronto), arquivar e excluir.
import { $, $$, state, api, busy, toast, esc, md, icon, pref } from "./core.js";

const NEXT = { "Ideia": "Explorando", "Explorando": "Proposta", "Proposta": "Virou card" };
const DISCARD = "Descartada";
const FIELDS = [["problem", "Problema"], ["proposal", "Proposta"], ["firstStep", "Primeiro passo"]];
const LEVELS = ["baixo", "médio", "alto"];
const ICON_EDIT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.5 13.5 5.5 6 13H3v-3z M9 4l3 3"/></svg>';
const ICON_OBS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>';
const ICON_DONE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5"/></svg>';
const ICON_BOX = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12v3H2zM3 6.5v6h10v-6M6.5 9h3"/></svg>';

/* ---------- filtros (lembrados neste navegador, menos a busca) ---------- */
const F = { q: "", areas: [], stages: [], descartadas: null, arquivadas: false, fechadas: false };
function loadFilters() { Object.assign(F, pref("ideiasFiltros") || {}, { q: "" }); }
function saveFilters() { const { q, ...rest } = F; pref("ideiasFiltros", rest); }
const showDiscarded = () => F.descartadas ?? !!state.cfg?.ideias?.mostrar_descartadas;
const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
const norm = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const items = () => state.vault?.ideias?.items || [];
/* estado dos cards citados (GitHub, só leitura): { id: { refs: [{ short, state, url, title, kind }], done } } */
let CARDS = { cards: {} };
const cardInfo = (i) => CARDS.cards?.[i.id];
const cardDone = (i) => !i.closed && !!cardInfo(i)?.done;
const STATE_TXT = { OPEN: "aberto", CLOSED: "fechado", MERGED: "mergeada", NOT_PLANNED: "fechado sem fazer", UNKNOWN: "não achei" };
async function loadCards() {
  try { CARDS = await api("/api/ideias/cards"); } catch (e) { CARDS = { error: e.message, cards: {} }; }
  if (state.view === "ideias") renderIdeias();
}
const byId = (id) => items().find((i) => i.id === id);
function areaColor(a) {
  const list = state.cfg?.ideias?.areas || [];
  const i = list.findIndex((x) => norm(x) === norm(a));
  return i < 0 ? "var(--color-muted)" : `var(--list-${(i % 5) + 1})`;
}
const quick = (i) => norm(i.impact) === "alto" && norm(i.effort) === "baixo";
function matches(i) {
  if (!F.arquivadas && i.archived) return false;
  if (!F.fechadas && i.closed) return false;
  if (F.areas.length && !F.areas.includes(i.area || "")) return false;
  if (!F.q.trim()) return true;
  const hay = norm([i.title, i.area, i.card, i.problem, i.proposal, i.firstStep, i.text, ...(i.obs || []).map((o) => o.text)].join(" "));
  return norm(F.q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/* ---------- quadro ---------- */
function cardHTML(i, stages) {
  const si = stages.indexOf(i.stage);
  const prev = i.problem || i.proposal || i.text || "";
  const n = (i.obs || []).length;
  const done = cardDone(i);
  return `<article class="idea${i.archived ? " is-archived" : ""}${i.closed ? " is-closed" : ""}" data-idea="${i.id}" draggable="true" style="--lc:${areaColor(i.area)}">
    <button type="button" class="idea-open" data-open-idea="${i.id}" aria-haspopup="dialog">${esc(i.title)}</button>
    <p class="chips-s">${i.area ? `<span class="idea-area"><span class="ag-dot" aria-hidden="true"></span>${esc(i.area)}</span>` : ""}${i.impact ? `<span>impacto ${esc(i.impact)}</span>` : ""}${i.effort ? `<span>esforço ${esc(i.effort)}</span>` : ""}${quick(i) ? `<span class="ag-kind">ganho rápido</span>` : ""}</p>
    ${prev ? `<p class="idea-prev">${esc(prev.replace(/\*\*/g, "").replace(/\s+/g, " ").slice(0, 220))}</p>` : ""}
    <div class="idea-foot">
      <span class="idea-inds">${n ? `<span class="ag-ind num" title="${n} ${n === 1 ? "observação" : "observações"}">${ICON_OBS}${n}</span>` : ""}${i.card ? `<span class="tag" title="${esc(i.card)}">${esc(i.card.split(/[\s(,]/)[0])}</span>` : ""}${done ? `<span class="tag tag-done" title="Todos os cards citados já fecharam ou foram mergeados">${ICON_DONE}card pronto</span>` : ""}${i.closed ? `<span class="tag tag-done">${ICON_DONE}fechada ${esc(i.closed)}</span>` : ""}${i.archived ? `<span class="tag">arquivada</span>` : ""}</span>
      <span class="idea-tools">
        ${si > 0 && i.stage !== DISCARD ? `<button type="button" class="btn btn-text btn-icon" data-move="${esc(stages[si - 1])}" aria-label="Voltar para ${esc(stages[si - 1])}" title="Voltar para ${esc(stages[si - 1])}">${icon.left}</button>` : ""}
        ${done ? `<button type="button" class="btn btn-ghost btn-sm" data-close-idea="${i.id}" title="O card ficou pronto: a ideia sai do quadro e fica na nota como fechada">${ICON_DONE} Fechar</button>` : ""}
        ${NEXT[i.stage] ? `<button type="button" class="btn btn-ghost btn-sm" data-move="${esc(NEXT[i.stage])}">${esc(NEXT[i.stage])} ${icon.right}</button>` : ""}
        ${i.stage === DISCARD ? `<button type="button" class="btn btn-ghost btn-sm" data-move="Ideia">Reabrir</button>` : ""}
      </span>
    </div></article>`;
}

function renderFilters(all) {
  const el = $("#ideias-filtros"); if (!el) return;
  const cfgAreas = state.cfg?.ideias?.areas || [];
  const used = [...new Set(all.map((i) => i.area || ""))];
  const areas = [...cfgAreas.filter((a) => used.includes(a)), ...used.filter((a) => a && !cfgAreas.includes(a)).sort()];
  if (used.includes("")) areas.push("");
  const stages = (state.vault?.ideias?.stages || []).filter((s) => s !== DISCARD);
  const nDisc = all.filter((i) => i.stage === DISCARD).length;
  const nArch = all.filter((i) => i.archived).length;
  const nClosed = all.filter((i) => i.closed).length;
  const chip = (attr, val, on, label, extra = "") => `<button type="button" class="chip${on ? " is-on" : ""}" ${attr}="${esc(val)}" aria-pressed="${on}"${extra}>${label}</button>`;
  const ativos = F.areas.length || F.stages.length || F.q || F.arquivadas || F.fechadas || F.descartadas !== null;
  const qFocused = document.activeElement?.id === "id-q";
  el.innerHTML = `
    <div class="ag-frow">
      <label class="ag-search"><span class="visually-hidden">Buscar nas ideias</span><input type="search" id="id-q" placeholder="Buscar (/)" value="${esc(F.q)}" autocomplete="off"></label>
      <label class="ag-toggle"><input type="checkbox" id="id-desc"${showDiscarded() ? " checked" : ""}> descartadas <span class="count num">${nDisc}</span></label>
      <label class="ag-toggle"><input type="checkbox" id="id-fech"${F.fechadas ? " checked" : ""}> fechadas <span class="count num">${nClosed}</span></label>
      <label class="ag-toggle"><input type="checkbox" id="id-arq"${F.arquivadas ? " checked" : ""}> arquivadas <span class="count num">${nArch}</span></label>
      ${ativos ? `<button type="button" class="btn btn-text btn-sm" data-iclear>Limpar filtros</button>` : ""}
    </div>
    ${CARDS.error ? `<p class="muted small">Não consegui ver o estado dos cards no GitHub: ${esc(CARDS.error)}</p>` : ""}
    <div class="ag-frow" role="group" aria-label="Estágios"><span class="ag-flabel">Estágios</span>${stages.map((s) => chip("data-fstage", s, F.stages.includes(s), esc(s))).join("")}</div>
    ${areas.length > 1 ? `<div class="ag-frow" role="group" aria-label="Áreas"><span class="ag-flabel">Áreas</span>${areas.map((a) => chip("data-farea", a, F.areas.includes(a), `<span class="ag-dot" aria-hidden="true"></span>${esc(a || "Sem área")}`, ` style="--lc:${areaColor(a)}"`)).join("")}</div>` : ""}`;
  if (qFocused) { const q = $("#id-q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

export function renderIdeias() {
  const v = state.vault; if (!v) return;
  const { stages } = v.ideias; const all = items();
  const job = v.jobs?.ideias; const btn = $("#ask-btn");
  if (job?.state === "running") { btn.setAttribute("aria-busy", "true"); btn.disabled = true; $("#ask-status").textContent = "O Claude está pensando em caminhos… (uns 20 segundos)"; }
  else {
    btn.removeAttribute("aria-busy"); btn.disabled = false;
    if (job?.state === "done") $("#ask-status").textContent = `Pronto: ${job.msg} na coluna Ideia.`;
    if (job?.state === "error") $("#ask-status").textContent = `Não deu certo: ${job.msg}`;
  }
  renderFilters(all);
  const lanes = stages.filter((s) => (s === DISCARD ? showDiscarded() : !F.stages.length || F.stages.includes(s)));
  const board = $("#board");
  board.style.gridTemplateColumns = lanes.map((s, k) => (k === 0 && s === "Ideia" && lanes.length > 2 ? "minmax(18rem, 1.4fr)" : "minmax(15rem, 1fr)")).join(" ");
  const filtering = F.q.trim() || F.areas.length;
  board.innerHTML = lanes.map((st) => {
    const list = all.filter((i) => i.stage === st && matches(i));
    const total = all.filter((i) => i.stage === st && (F.arquivadas || !i.archived) && (F.fechadas || !i.closed)).length;
    const prontas = list.filter(cardDone);
    const empty = filtering && total ? "Nada com esses filtros." : st === "Ideia" ? "Peça sugestões acima ou anote uma ideia sua." : "Vazio. Arraste uma ideia para cá.";
    return `<section class="lane${st === DISCARD ? " is-muted" : ""}" data-lane="${esc(st)}" aria-label="${esc(st)}"><h2>${esc(st)} <span class="count num">${filtering ? `${list.length} de ${total}` : list.length}</span></h2>
      ${prontas.length > 1 ? `<button type="button" class="btn btn-ghost btn-sm lane-act" data-close-all="${prontas.map((i) => i.id).join(",")}">${ICON_DONE} Fechar as ${prontas.length} com card pronto</button>` : ""}
      ${list.map((i) => cardHTML(i, stages)).join("") || `<p class="empty">${empty}</p>`}
    </section>`;
  }).join("");
  refreshIdea();
}

/* ---------- painel de detalhes ---------- */
let openId = null; let editing = false; let confirmDel = false; let A = {};
const dlg = () => $("#idea-detail");
export const ideaOpen = () => dlg()?.open;

function levelSelect(name, val) {
  const opts = [...LEVELS, ...(val && !LEVELS.includes(val) ? [val] : [])];
  return `<select name="${name}"><option value="">—</option>${opts.map((o) => `<option${o === val ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
}
function editHTML(i) {
  const cfgAreas = state.cfg?.ideias?.areas || [];
  const areas = [...cfgAreas, ...(i.area && !cfgAreas.includes(i.area) ? [i.area] : [])];
  return `<form class="drawer-edit" data-idea-form>
    <label>Título<input name="title" value="${esc(i.title)}" required maxlength="140" autocomplete="off"></label>
    <div class="idd-row">
      <label>Área<select name="area"><option value="">Sem área</option>${areas.map((a) => `<option${a === i.area ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></label>
      <label>Impacto${levelSelect("impact", i.impact || "")}</label>
      <label>Esforço${levelSelect("effort", i.effort || "")}</label>
    </div>
    <label>Card<input name="card" value="${esc(i.card || "")}" autocomplete="off" placeholder="Ex.: PROJ-12 (#34)"></label>
    ${FIELDS.map(([k, l]) => `<label>${l}<textarea name="${k}" rows="${k === "firstStep" ? 2 : 3}">${esc(i[k] || "")}</textarea></label>`).join("")}
    <label>Notas<textarea name="text" rows="6" placeholder="Explorações, decisões, links. Markdown funciona.">${esc(i.text || "")}</textarea></label>
    <p class="muted small">Salva na nota do vault, mexendo só no que mudou. Ctrl+Enter salva, Esc cancela.</p>
    <div class="drawer-edit-f"><button type="submit" class="btn btn-primary btn-sm">Salvar</button><button type="button" class="btn btn-text btn-sm" data-edit-cancel>Cancelar</button></div>
  </form>`;
}
function viewHTML(i, stages) {
  const chips = [i.impact ? `<span class="tag">impacto ${esc(i.impact)}</span>` : "", i.effort ? `<span class="tag">esforço ${esc(i.effort)}</span>` : "",
    quick(i) ? `<span class="ag-kind">ganho rápido</span>` : "", i.card ? `<span class="tag">card ${esc(i.card)}</span>` : "",
    i.closed ? `<span class="tag tag-done">${ICON_DONE}fechada em ${esc(i.closed)}</span>` : "",
    i.archived ? `<span class="tag">arquivada em ${esc(i.archived)}</span>` : ""].filter(Boolean).join("");
  const ci = cardInfo(i);
  const cardSec = ci?.refs?.length ? `<section class="drawer-sec"><h3>Cards no GitHub</h3><ul class="idd-cards">${ci.refs.map((r) =>
    `<li class="is-${r.state.toLowerCase()}"><span class="idd-cstate">${STATE_TXT[r.state] || esc(r.state)}</span> ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.short)}</a>` : esc(r.short)}${r.title ? ` <span class="muted">${esc(r.title)}</span>` : ""}</li>`).join("")}</ul>
    ${cardDone(i) ? `<p class="small">Todos já fecharam. Dá para fechar a ideia: ela sai do quadro e fica na nota.</p>` : ""}</section>` : "";
  const secs = FIELDS.filter(([k]) => i[k]).map(([k, l]) => `<section class="drawer-sec"><h3>${l}</h3><div class="drawer-md">${md(i[k])}</div></section>`).join("");
  const obs = i.obs || [];
  return `<div class="drawer-title"><h2 id="idd-h" class="drawer-t">${esc(i.title)}</h2>
      <button type="button" class="btn btn-text btn-icon" data-edit aria-label="Editar ideia" title="Editar ideia (E)">${ICON_EDIT}</button></div>
    ${chips ? `<div class="drawer-chips">${chips}</div>` : ""}
    <div class="drawer-kind"><span id="idd-stage">Estágio</span><div class="seg seg-sm idd-stages" role="radiogroup" aria-labelledby="idd-stage">${stages.map((s) =>
      `<button type="button" role="radio" data-stage="${esc(s)}" aria-checked="${s === i.stage}">${esc(s)}</button>`).join("")}</div></div>
    ${cardSec}
    ${secs}
    ${i.text ? `<section class="drawer-sec"><h3>Notas</h3><div class="drawer-md">${md(i.text)}</div></section>` : ""}
    ${!secs && !i.text ? `<button type="button" class="drawer-add-note" data-edit>+ Escrever problema, proposta e primeiro passo</button>` : ""}
    <section class="drawer-sec idd-obs-sec"><h3>Observações <span class="count num">${obs.length || ""}</span></h3>
      ${obs.length ? `<ol class="idd-obs">${obs.map((o) => `<li><time class="num">${esc(o.date)}</time><div class="drawer-md">${md(o.text)}</div></li>`).join("")}</ol>` : ""}
      <form class="idd-obs-add" data-obs-form>
        <label class="visually-hidden" for="idd-obs-t">Nova observação</label>
        <textarea id="idd-obs-t" name="obs" rows="2" placeholder="Uma observação nova (entra com a data de hoje)"></textarea>
        <button type="submit" class="btn btn-ghost btn-sm">Adicionar</button>
      </form>
    </section>
    ${i.origin ? `<p class="muted small idd-origin">Origem: ${esc(i.origin)}</p>` : ""}`;
}
function footHTML(i) {
  if (confirmDel) return `<footer class="drawer-f idd-confirm" role="alert">
      <p>Excluir esta ideia de vez? O bloco inteiro sai da nota, com observações e notas, e não tem volta.</p>
      <button type="button" class="btn btn-danger-solid btn-sm" data-act="del-yes">Excluir de vez</button>
      <button type="button" class="btn btn-text btn-sm" data-act="del-no">Cancelar</button></footer>`;
  return `<footer class="drawer-f">
      ${i.closed || cardDone(i) || i.stage === "Virou card" ? `<button type="button" class="btn ${cardDone(i) ? "btn-primary" : "btn-text"} btn-sm" data-act="close" title="${i.closed ? "Volta para o quadro" : "O card ficou pronto: sai do quadro e fica na nota como fechada"}">${ICON_DONE} ${i.closed ? "Reabrir" : "Fechar ideia"}</button>` : ""}
      ${i.stage !== DISCARD ? `<button type="button" class="btn btn-text btn-sm" data-act="discard">Descartar</button>` : ""}
      <button type="button" class="btn btn-text btn-sm" data-act="archive" title="${i.archived ? "Volta para o quadro" : "Some do quadro e continua na nota"}">${ICON_BOX} ${i.archived ? "Desarquivar" : "Arquivar"}</button>
      ${i.stage === DISCARD ? `<button type="button" class="btn btn-text btn-sm btn-danger" data-act="del">Excluir de vez</button>` : ""}
    </footer>`;
}
function renderIdea() {
  const d = dlg(); const i = byId(openId);
  if (!i) { if (d.open) { toast("Essa ideia mudou no arquivo ou saiu da nota."); d.close(); } openId = null; return; }
  const stages = state.vault.ideias.stages;
  const draft = d.querySelector("#idd-obs-t")?.value || "";
  d.innerHTML = `<div class="drawer-in" style="--lc:${areaColor(i.area)}">
    <header class="drawer-h"><p class="eyebrow"><span class="ag-dot" aria-hidden="true"></span>${esc(i.area || "Sem área")}</p>
      <button type="button" class="btn btn-text btn-icon" data-close aria-label="Fechar detalhes">${icon.x}</button></header>
    ${editing ? editHTML(i) : viewHTML(i, stages)}
    ${editing ? "" : footHTML(i)}</div>`;
  const t = d.querySelector("#idd-obs-t"); if (t && draft) t.value = draft;
}
function refreshIdea() { if (openId && ideaOpen() && !editing) renderIdea(); }
export function openIdea(id) {
  openId = id; editing = false; confirmDel = false; renderIdea();
  const d = dlg(); if (!openId) return; if (!d.open) d.showModal();
  d.querySelector("[data-close]")?.focus();
}
function setEditing(on) {
  editing = on; confirmDel = false; renderIdea();
  if (on) { const t = dlg().querySelector("[name=title]"); t?.focus(); }
  else dlg().querySelector("[data-edit]")?.focus();
}

/* ---------- ações ---------- */
async function closeIdeas(ids, on, btn) {
  return busy(btn, async () => {
    for (const id of ids) await api("/api/ideia/close", { id, on });
    toast(!on ? "Ideia de volta ao quadro." : ids.length > 1 ? `${ids.length} ideias fechadas: continuam na nota, fora do quadro.` : "Fechada: continua na nota, fora do quadro.");
    await A.reload(); return true;
  });
}
async function move(id, stage, btn) {
  return busy(btn, async () => { await api("/api/ideia/move", { id, stage }); await A.reload(); return true; });
}
async function saveEdit(i, form) {
  const val = (n) => form.elements[n].value;
  const body = { id: i.id, rev: i.rev };
  if (!val("title").trim()) { form.elements.title.focus(); return; }
  if (val("title").trim() !== i.title) body.title = val("title");
  for (const k of ["area", "impact", "effort", "card"]) if (val(k).trim() !== (i[k] || "")) body[k] = val(k);
  for (const [k] of FIELDS) if (val(k).trim() !== (i[k] || "")) body[k] = val(k);
  if (val("text").trim() !== (i.text || "")) body.text = val("text");
  if (Object.keys(body).length === 2) { setEditing(false); return; }
  await busy(form.querySelector("[type=submit]"), async () => {
    const r = await api("/api/ideia/edit", body);
    openId = r.result || i.id; editing = false; toast("Ideia salva na nota.");
    await A.reload(); dlg().querySelector("[data-edit]")?.focus();
  });
}
async function addObs(i, form) {
  const t = form.elements.obs; const text = t.value.trim();
  if (!text) { t.focus(); return; }
  await busy(form.querySelector("[type=submit]"), async () => {
    await api("/api/ideia/obs", { id: i.id, text }); t.value = ""; toast("Observação guardada na nota.");
    await A.reload(); dlg().querySelector("#idd-obs-t")?.focus();
  });
}
async function act(i, name, btn) {
  if (name === "del") { confirmDel = true; renderIdea(); dlg().querySelector("[data-act=del-no]")?.focus(); return; }
  if (name === "del-no") { confirmDel = false; renderIdea(); dlg().querySelector("[data-act=del]")?.focus(); return; }
  if (name === "del-yes") {
    await busy(btn, async () => { await api("/api/ideia/delete", { id: i.id, rev: i.rev }); openId = null; dlg().close(); toast("Ideia excluída da nota."); await A.reload(); });
    return;
  }
  if (name === "archive") {
    await busy(btn, async () => { await api("/api/ideia/archive", { id: i.id, on: !i.archived }); toast(i.archived ? "Ideia de volta ao quadro." : "Arquivada: continua na nota, fora do quadro."); await A.reload(); });
    return;
  }
  if (name === "close") { await closeIdeas([i.id], !i.closed, btn); return; }
  if (name === "discard") await move(i.id, DISCARD, btn);
}

export function bindIdeias({ ask, reload }) {
  A = { reload: async () => { await reload(); loadCards(); } }; loadFilters(); loadCards();
  const view = $('.view[data-view="ideias"]');
  const board = $("#board");
  board.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-move]");
    if (b) { move(b.closest("[data-idea]").dataset.idea, b.dataset.move, b); return; }
    const c = e.target.closest("button[data-close-idea]"); if (c) { closeIdeas([c.dataset.closeIdea], true, c); return; }
    const all = e.target.closest("button[data-close-all]"); if (all) { closeIdeas(all.dataset.closeAll.split(","), true, all); return; }
    const o = e.target.closest("[data-idea]");
    if (o && !e.target.closest("a, button:not([data-open-idea])")) openIdea(o.dataset.idea);
  });
  // arrastar entre colunas
  let dragId = null;
  board.addEventListener("dragstart", (e) => {
    const c = e.target.closest?.("[data-idea]"); if (!c) return;
    dragId = c.dataset.idea; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId); c.classList.add("is-dragging");
  });
  board.addEventListener("dragend", () => { dragId = null; $$(".is-dragging, .is-drop", board).forEach((x) => x.classList.remove("is-dragging", "is-drop")); });
  board.addEventListener("dragover", (e) => {
    const lane = e.target.closest("[data-lane]"); if (!lane || !dragId) return;
    e.preventDefault(); $$(".lane.is-drop", board).forEach((x) => x !== lane && x.classList.remove("is-drop")); lane.classList.add("is-drop");
  });
  board.addEventListener("dragleave", (e) => { const lane = e.target.closest("[data-lane]"); if (lane && !lane.contains(e.relatedTarget)) lane.classList.remove("is-drop"); });
  board.addEventListener("drop", (e) => {
    const lane = e.target.closest("[data-lane]"); if (!lane || !dragId) return;
    e.preventDefault(); lane.classList.remove("is-drop");
    const i = byId(dragId); if (i && i.stage !== lane.dataset.lane) move(i.id, lane.dataset.lane, null);
  });
  // filtros
  view.addEventListener("click", (e) => {
    const s = e.target.closest("[data-fstage]"); if (s) { F.stages = toggle(F.stages, s.dataset.fstage); saveFilters(); renderIdeias(); return; }
    const a = e.target.closest("[data-farea]"); if (a) { F.areas = toggle(F.areas, a.dataset.farea); saveFilters(); renderIdeias(); return; }
    if (e.target.closest("[data-iclear]")) { Object.assign(F, { q: "", areas: [], stages: [], descartadas: null, arquivadas: false, fechadas: false }); saveFilters(); renderIdeias(); }
  });
  view.addEventListener("input", (e) => { if (e.target.id === "id-q") { F.q = e.target.value; renderIdeias(); } });
  view.addEventListener("change", (e) => {
    if (e.target.id === "id-desc") { F.descartadas = e.target.checked; saveFilters(); renderIdeias(); }
    if (e.target.id === "id-arq") { F.arquivadas = e.target.checked; saveFilters(); renderIdeias(); }
    if (e.target.id === "id-fech") { F.fechadas = e.target.checked; saveFilters(); renderIdeias(); }
  });
  // painel
  const d = dlg();
  const cur = () => byId(openId);
  d.addEventListener("close", () => { const back = board.querySelector(`[data-open-idea="${openId}"]`); openId = null; editing = false; confirmDel = false; back?.focus(); });
  d.addEventListener("cancel", (e) => {
    if (editing) { e.preventDefault(); setEditing(false); }
    else if (confirmDel) { e.preventDefault(); confirmDel = false; renderIdea(); }
  });
  d.addEventListener("submit", (e) => {
    e.preventDefault(); const i = cur(); if (!i) return;
    if (e.target.closest("[data-idea-form]")) saveEdit(i, e.target);
    else if (e.target.closest("[data-obs-form]")) addObs(i, e.target);
  });
  d.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { const f = e.target.closest("form"); if (f) { e.preventDefault(); f.requestSubmit(); } }
    else if (!editing && (e.key === "e" || e.key === "E") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest("input, textarea, select")) { e.preventDefault(); setEditing(true); }
  });
  d.addEventListener("click", async (e) => {
    if (e.target === d || e.target.closest("[data-close]")) { d.close(); return; }
    if (e.target.closest("[data-edit]")) { setEditing(true); return; }
    if (e.target.closest("[data-edit-cancel]")) { setEditing(false); return; }
    const i = cur(); if (!i) return;
    const sb = e.target.closest("button[data-stage]");
    if (sb) { if (sb.dataset.stage !== i.stage) await move(i.id, sb.dataset.stage, sb); return; }
    const b = e.target.closest("button[data-act]"); if (b) await act(i, b.dataset.act, b);
  });
  // atalhos e o resto da aba
  document.addEventListener("keydown", (e) => {
    if (state.view !== "ideias" || ideaOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest("input, textarea, select")) { if (e.key === "Escape" && e.target.id === "id-q") { F.q = ""; e.target.blur(); renderIdeias(); } return; }
    if (e.key === "/") { e.preventDefault(); $("#id-q")?.focus(); }
  });
  $(".chips").addEventListener("click", (e) => { const c = e.target.closest(".chip[data-foco]"); if (!c) return; $("#foco").value = c.dataset.foco; $("#foco").focus(); });
  $("#ask").addEventListener("submit", (e) => { e.preventDefault(); ask($("#foco").value, $("#ask-btn")); });
}
