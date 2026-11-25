import { $, $$, state, esc, WD, WDS, MONTHS, pad, dayKey, todayKey, addDays, startOfWeek, shortDate, taskDay, isLate, taskTime, projectInfo, tt, pref, icon } from "./core.js";
import { MABBR, rules, janela, parts, kind, diffDays, rel, badge, matTag, ICON_NOTE, ICON_LIST, refreshTask, taskOpen } from "./tarefa.js";

const byTime = (a, b) => (a.done !== b.done ? (a.done ? 1 : -1)
  : (kind(a) ? 0 : 1) - (kind(b) ? 0 : 1) || (a.allDay === b.allDay ? (a.start || "").localeCompare(b.start || "") : a.allDay ? -1 : 1));

/* ---------- filtros (lembrados no navegador) ---------- */
const F = { q: "", foco: "tudo", listas: [], mats: [], feitas: false };
function loadFilters() { Object.assign(F, pref("agendaFiltros") || {}, { q: "" }); }
function saveFilters() { const { q, ...rest } = F; pref("agendaFiltros", rest); }
function passes(t) {
  if (!F.feitas && t.done) return false;
  if (F.foco === "atrasadas" && !isLate(t)) return false;
  if (F.foco === "importantes" && !kind(t)) return false;
  if (F.listas.length && !F.listas.includes(t.projectId)) return false;
  if (F.mats.length && !F.mats.includes(parts(t).mat)) return false;
  if (F.q && !t.title.toLowerCase().includes(F.q.toLowerCase())) return false;
  return true;
}
// Datas trocadas na tela esperando o TickTick: sobrevivem a um recarregamento em segundo plano.
const pending = new Map();
const allTasks = () => { const ts = tt()?.tasks || []; if (pending.size) ts.forEach((t) => { const o = pending.get(t.id); if (o) Object.assign(t, o); }); return ts; };
const visible = () => allTasks().filter(passes);
const tasksOn = (k, list = visible()) => list.filter((t) => taskDay(t) === k).sort(byTime);

/* ---------- peças ---------- */
// Linha enxuta: um círculo de concluir e o resto abre os detalhes. Adiar e abrir no TickTick ficam no painel.
function itemHTML(t, { compact = false, showDay = false } = {}) {
  const p = projectInfo(t.projectId); const tm = taskTime(t); const late = isLate(t); const { mat, title } = parts(t); const k = kind(t);
  const meta = [
    tm && !t.done ? `<time class="num">${tm}</time>` : "",
    showDay && taskDay(t) ? `<span class="num">${shortDate(new Date(taskDay(t) + "T12:00"))}</span>` : "",
    t.done ? "<span>feita</span>" : late ? `<span class="late">atrasada ${rel(taskDay(t))}</span>` : "",
    compact ? "" : `<span class="ag-list" style="--lc:${p.color}">${esc(p.name)}</span>`,
    t.items ? `<span class="ag-ind num">${ICON_LIST}${t.itemsDone}/${t.items}</span>` : "",
    t.content ? `<span class="ag-ind" title="Tem notas">${ICON_NOTE}<span class="visually-hidden">tem notas</span></span>` : "",
  ].filter(Boolean).join("");
  const check = t.done
    ? `<span class="ag-check is-on" aria-hidden="true">${icon.check}</span>`
    : `<button type="button" class="ag-check" data-act="done" aria-label="Concluir ${esc(title)}" title="Concluir">${icon.check}</button>`;
  return `<div class="ag-item${late ? " is-late" : ""}${t.done ? " is-done" : ""}${k ? ` is-${k}` : ""}${compact ? " is-compact" : ""}" data-task="${t.id}"${t.done ? "" : ' draggable="true"'} style="--lc:${p.color}">
    ${check}<button type="button" class="ag-open" data-open-task="${t.id}" aria-haspopup="dialog"><span class="ag-title">${matTag(mat)}${badge(t)}<span>${esc(title)}</span></span>${meta ? `<span class="ag-meta">${meta}</span>` : ""}</button></div>`;
}

/* ---------- radar ---------- */
function renderRadar() {
  const el = $("#ag-radar"); const all = allTasks().filter((t) => !t.done); const tk = todayKey();
  if (!tt()) { el.innerHTML = ""; return; }
  const late = all.filter(isLate); const today = all.filter((t) => taskDay(t) === tk);
  const r = rules(); const limite = dayKey(addDays(new Date(), r.radar));
  const prox = all.filter((t) => kind(t) && taskDay(t) && taskDay(t) >= tk && taskDay(t) <= limite)
    .sort((a, b) => taskDay(a).localeCompare(taskDay(b)) || (kind(a) === "prova" ? -1 : 1));
  const provas = prox.filter((t) => kind(t) === "prova");
  const next = provas[0];
  // até 8 linhas: todas as provas entram, entregas completam pela data
  const vagas = Math.max(0, 8 - provas.length);
  const shown = prox.filter((t) => kind(t) === "prova" || prox.filter((x) => kind(x) !== "prova").indexOf(t) < vagas);
  el.innerHTML = `
    <button type="button" class="ag-stat${late.length ? " is-bad" : ""}" data-foco="atrasadas" aria-pressed="${F.foco === "atrasadas"}">
      <span class="ag-stat-n num">${late.length}</span><span class="ag-stat-l">atrasadas</span>
      <span class="ag-stat-s">${late.length ? `a mais antiga ${rel(late.map(taskDay).sort()[0])}` : "nada para trás"}</span></button>
    <button type="button" class="ag-stat" data-goto="${tk}">
      <span class="ag-stat-n num">${today.length}</span><span class="ag-stat-l">para hoje</span>
      <span class="ag-stat-s">${today.filter(kind).length ? `${today.filter(kind).length} com prazo` : "sem prazo duro"}</span></button>
    <button type="button" class="ag-stat is-hot" data-foco="importantes" aria-pressed="${F.foco === "importantes"}">
      <span class="ag-stat-n num">${provas.length}</span><span class="ag-stat-l">${esc(r.lp.many)} em ${janela(r.radar)}</span>
      <span class="ag-stat-s">${next ? `próxima ${rel(taskDay(next))}: ${esc(parts(next).mat || parts(next).title)}` : "nenhuma marcada"}</span></button>
    <div class="ag-prazos panel"><h2>Próximos prazos${prox.length > shown.length ? `<span class="count">mais ${prox.length - shown.length} no filtro de prazos</span>` : ""}</h2>${prox.length ? `<ol>${shown.map((t) => {
      const k = taskDay(t); const n = diffDays(k); const d = new Date(k + "T12:00");
      return `<li><button type="button" class="ag-prazo${kind(t) === "prova" ? " is-prova" : ""}${n <= 3 ? " is-soon" : ""}" data-goto="${k}">
        <span class="ag-when"><b class="num">${n === 0 ? "hoje" : n}</b>${n === 0 ? "" : `<small>${n === 1 ? "dia" : "dias"}</small>`}</span>
        <span class="ag-what">${matTag(parts(t).mat)}<span>${esc(parts(t).title)}</span><small>${WD[d.getDay()]}, ${shortDate(d)}</small></span></button></li>`;
    }).join("")}</ol>` : `<p class="empty">Nenhum prazo nos próximos ${janela(r.radar)}.</p>`}</div>`;
}

/* ---------- barra de filtros ---------- */
function renderFilters() {
  const data = tt(); const el = $("#ag-filters"); if (!data) { el.innerHTML = ""; return; }
  const open = allTasks().filter((t) => !t.done);
  const mats = [...new Set(open.map((t) => parts(t).mat).filter(Boolean))].sort();
  const lists = data.projects.filter((p) => open.some((t) => t.projectId === p.id));
  const chip = (attr, val, on, label, extra = "") => `<button type="button" class="chip${on ? " is-on" : ""}" ${attr}="${esc(val)}" aria-pressed="${on}"${extra}>${label}</button>`;
  const r = rules(); const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const ativos = F.foco !== "tudo" || F.listas.length || F.mats.length || F.feitas;
  el.innerHTML = `
    <div class="ag-frow">
      <label class="ag-search"><span class="visually-hidden">Buscar na agenda</span><input type="search" id="ag-q" placeholder="Buscar (/)" value="${esc(F.q)}" autocomplete="off"></label>
      <div class="seg" role="group" aria-label="Mostrar">
        ${[["tudo", "Tudo"], ["importantes", esc(`${cap(r.lp.many)} e ${r.le.many}`)], ["atrasadas", "Atrasadas"]].map(([v, l]) => `<button type="button" data-foco="${v}" aria-pressed="${F.foco === v}">${l}</button>`).join("")}
      </div>
      <label class="ag-toggle"><input type="checkbox" id="ag-feitas"${F.feitas ? " checked" : ""}> mostrar feitas</label>
      ${ativos ? `<button type="button" class="btn btn-text btn-sm" data-clear>Limpar filtros</button>` : ""}
    </div>
    ${mats.length ? `<div class="ag-frow" role="group" aria-label="${esc(r.codeLabel)}"><span class="ag-flabel">${esc(r.codeLabel)}</span>${mats.map((m) => chip("data-fmat", m, F.mats.includes(m), m)).join("")}</div>` : ""}
    <div class="ag-frow" role="group" aria-label="Listas"><span class="ag-flabel">Listas</span>${lists.map((p) => chip("data-flist", p.id, F.listas.includes(p.id), `<span class="ag-dot" aria-hidden="true"></span>${esc(projectInfo(p.id).name)}`, ` style="--lc:${projectInfo(p.id).color}"`)).join("")}</div>`;
}

/* ---------- escalas ---------- */
function renderLista() {
  const tk = todayKey(); const list = visible(); const r = rules(); const fimD = addDays(new Date(), r.semanas * 7 - 1); const fim = dayKey(fimD); const hoje = new Date();
  $("#agenda-h").innerHTML = hoje.getMonth() === fimD.getMonth()
    ? `<b class="num">${hoje.getDate()} a ${fimD.getDate()}</b> de ${MONTHS[hoje.getMonth()]}`
    : `<b class="num">${hoje.getDate()}</b> de ${MONTHS[hoje.getMonth()]} a <b class="num">${fimD.getDate()}</b> de ${MONTHS[fimD.getMonth()]}`;
  let mesAtual = -1; let semana = null;
  const late = list.filter((t) => isLate(t) && taskDay(t) < tk).sort((a, b) => taskDay(a).localeCompare(taskDay(b)));
  const groups = [];
  if (late.length) groups.push(`<section class="ag-group is-late" id="ag-d-late"><h2><span>Atrasadas</span><span class="count num">${late.length}</span></h2>${late.map((t) => itemHTML(t, { showDay: true })).join("")}</section>`);
  for (let d = new Date(); dayKey(d) <= fim; d = addDays(d, 1)) {
    const k = dayKey(d); const items = tasksOn(k, list).filter((t) => !(isLate(t) && k < tk));
    if (!items.length && k !== tk) continue;
    const n = diffDays(k); const hot = items.some((t) => kind(t) === "prova" && !t.done);
    if (d.getMonth() !== mesAtual) { if (mesAtual >= 0 || late.length) groups.push(`<p class="ag-monthmark"><span>${MONTHS[d.getMonth()]}</span> <span class="num">${d.getFullYear()}</span></p>`); mesAtual = d.getMonth(); }
    else if (semana && semana !== dayKey(startOfWeek(d))) { const w = startOfWeek(d); groups.push(`<p class="ag-weekmark">semana de ${w.getDate()} de ${MONTHS[w.getMonth()]}</p>`); }
    semana = dayKey(startOfWeek(d));
    groups.push(`<section class="ag-group${k === tk ? " is-today" : ""}${hot ? " is-hot" : ""}" id="ag-d-${k}" data-drop-day="${k}">
      <h2><span class="ag-gday">${n === 0 ? "Hoje" : n === 1 ? "Amanhã" : WD[d.getDay()]}</span><span class="ag-gdate num">${d.getDate()} de ${MONTHS[d.getMonth()]}</span>${hot ? `<span class="ag-kind is-prova">dia de ${esc(r.lp.one)}</span>` : ""}<span class="count num">${items.filter((t) => !t.done).length || ""}</span></h2>
      ${items.length ? items.map((t) => itemHTML(t)).join("") : `<p class="empty">Nada marcado.</p>`}</section>`);
  }
  const semData = list.filter((t) => !taskDay(t));
  if (semData.length) groups.push(`<details class="ag-group ag-nodate" data-drop-day=""${pref("agendaSemData") ? " open" : ""}><summary><h2><span>Sem data</span><span class="count num">${semData.length}</span></h2></summary>${semData.map((t) => itemHTML(t)).join("")}</details>`);
  $("#ag-lista").innerHTML = groups.join("") || `<p class="empty">Nada com esses filtros.</p>`;
}

function renderWeek() {
  const s = startOfWeek(state.agenda.ref); const e = addDays(s, 6); const tk = todayKey(); const list = visible();
  $("#agenda-h").innerHTML = s.getMonth() === e.getMonth()
    ? `<b class="num">${s.getDate()} a ${e.getDate()}</b> de ${MONTHS[s.getMonth()]}` : `<b class="num">${shortDate(s)} a ${shortDate(e)}</b>`;
  $("#week").innerHTML = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(s, i); const k = dayKey(d); const items = tasksOn(k, list); const hot = items.some((t) => kind(t) === "prova" && !t.done);
    return `<div data-drop-day="${k}" class="wday${i > 0 && d.getDate() === 1 ? " is-newmonth" : ""}${k === tk ? " is-today" : ""}${k < tk ? " is-past" : ""}${hot ? " is-hot" : ""}"><p class="wday-h"><span>${WDS[d.getDay()]}</span><b class="num">${d.getDate()}</b>${i === 0 || d.getDate() === 1 ? `<em class="wday-m">${MABBR[d.getMonth()]}</em>` : ""}${items.length ? `<small class="count num">${items.filter((t) => !t.done).length}</small>` : ""}</p>
      ${items.length ? items.map((t) => itemHTML(t, { compact: true })).join("") : `<p class="empty">${k < tk ? "Nada pendente" : "Livre"}</p>`}</div>`;
  }).join("");
}

function renderMonth() {
  const ref = state.agenda.ref; const y = ref.getFullYear(); const m = ref.getMonth(); const list = visible();
  $("#agenda-h").innerHTML = `<b>${MONTHS[m]}</b> <span class="num">${y}</span>`;
  const first = new Date(y, m, 1); const s = startOfWeek(first); const tk = todayKey();
  const weeks = Math.ceil(((first.getDay() + 6) % 7 + new Date(y, m + 1, 0).getDate()) / 7);
  const heads = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((d) => `<div class="mhead" role="columnheader">${d}</div>`).join("");
  const a = state.agenda;
  if (!a.selDay || new Date(a.selDay + "T12:00").getMonth() !== m) a.selDay = tk.startsWith(`${y}-${pad(m + 1)}`) ? tk : dayKey(first);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => {
    const d = addDays(s, i); const k = dayKey(d); const items = tasksOn(k, list);
    const prova = items.find((t) => kind(t) === "prova" && !t.done); const late = items.some((t) => isLate(t));
    const cls = ["mcell"]; if (d.getMonth() !== m) cls.push("is-out"); if (k === tk) cls.push("is-today"); if (prova) cls.push("is-hot"); if (k < tk) cls.push("is-past");
    const shown = items.slice(0, 3).map((t) => `<span class="mitem${t.done ? " is-done" : ""}${kind(t) ? ` is-${kind(t)}` : ""}" data-task="${t.id}"${t.done ? "" : ' draggable="true"'} style="--lc:${projectInfo(t.projectId).color}">${parts(t).mat ? `<b>${esc(parts(t).mat)}</b> ` : ""}${esc(parts(t).title)}</span>`).join("");
    const more = items.length > 3 ? `<span class="mmore">mais ${items.length - 3}</span>` : "";
    return `<button type="button" role="gridcell" class="${cls.join(" ")}" data-day="${k}" data-drop-day="${k}" aria-selected="${k === a.selDay}" aria-label="${d.getDate()} de ${MONTHS[d.getMonth()]}, ${items.length} tarefas${prova ? `, dia de ${esc(rules().lp.one)}` : ""}"><span class="mcell-n num">${d.getDate()}${d.getDate() === 1 || (d.getMonth() !== m && i % 7 === 0) || (d.getMonth() !== m && i === weeks * 7 - 7) ? ` <em>${MABBR[d.getMonth()]}</em>` : ""}${late ? '<i class="mlate" aria-hidden="true"></i>' : ""}</span>${shown}${more}<span class="mcount num">${items.length || ""}</span></button>`;
  }).join("");
  $("#month").innerHTML = heads + cells;
  renderDay();
}
function renderDay() {
  const k = state.agenda.selDay; if (!k) return;
  const d = new Date(k + "T12:00"); const items = tasksOn(k);
  $("#day-panel").innerHTML = `<h2>${WD[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}<span class="count">${rel(k)}</span></h2>${items.length ? items.map((t) => itemHTML(t)).join("") : `<p class="empty">Nada marcado neste dia.</p>`}`;
}

export function renderAgenda() {
  const sc = state.agenda.scale;
  $$("[data-scale]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scale === sc)));
  $("#ag-lista").hidden = sc !== "lista"; $("#week").hidden = sc !== "semana"; $("#month-wrap").hidden = sc !== "mes";
  $(".cal-nav").hidden = sc === "lista";
  if (!tt()) {
    $("#ag-radar").innerHTML = ""; $("#ag-filters").innerHTML = "";
    $(sc === "lista" ? "#ag-lista" : sc === "semana" ? "#week" : "#month").innerHTML = `<div class="skeleton"><span></span><span></span><span></span></div>`;
    $("#agenda-h").textContent = "Agenda"; return;
  }
  renderRadar();
  const focused = document.activeElement?.id === "ag-q"; const caret = focused ? $("#ag-q").selectionStart : 0;
  renderFilters();
  if (focused) { const q = $("#ag-q"); q.focus(); q.setSelectionRange(caret, caret); }
  if (sc === "lista") renderLista(); else if (sc === "semana") renderWeek(); else renderMonth();
  refreshTask();
}

/* ---------- interação ---------- */
function goto(k) {
  const a = state.agenda;
  if (a.scale === "lista") {
    const el = document.getElementById(`ag-d-${k}`);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); el.classList.add("is-flash"); setTimeout(() => el.classList.remove("is-flash"), 1200); return; }
    a.scale = pref("agendaScale", "mes");
  }
  a.ref = new Date(k + "T12:00"); a.selDay = k; renderAgenda();
}
function step(n) {
  const a = state.agenda;
  if (a.scale === "lista") return;
  if (a.scale === "semana") a.ref = n ? addDays(a.ref, n * 7) : new Date();
  else { a.ref = n ? new Date(a.ref.getFullYear(), a.ref.getMonth() + n, 1) : new Date(); a.selDay = null; }
  renderAgenda();
}
/* ---------- arrastar para outro dia ---------- */
// Muda na tela na hora (mesmo horário, outro dia) e desfaz se o TickTick recusar.
const moveDays = (v, n) => (v ? new Date(new Date(v).getTime() + n * 86400000).toISOString() : v);
function bindDrag(view, setDate) {
  let dragId = null;
  const clear = () => $$(".is-dragging, .is-drop", view).forEach((x) => x.classList.remove("is-dragging", "is-drop"));
  view.addEventListener("dragstart", (e) => {
    const it = e.target.closest?.("[draggable=true][data-task]"); if (!it) return;
    dragId = it.dataset.task; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId);
    requestAnimationFrame(() => it.classList.add("is-dragging"));
  });
  view.addEventListener("dragend", () => { dragId = null; clear(); });
  view.addEventListener("dragover", (e) => {
    const z = dragId && e.target.closest("[data-drop-day]"); if (!z) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    if (!z.classList.contains("is-drop")) { $$(".is-drop", view).forEach((x) => x.classList.remove("is-drop")); z.classList.add("is-drop"); }
  });
  view.addEventListener("dragleave", (e) => { const z = e.target.closest("[data-drop-day]"); if (z && !z.contains(e.relatedTarget)) z.classList.remove("is-drop"); });
  view.addEventListener("drop", async (e) => {
    const z = dragId && e.target.closest("[data-drop-day]"); if (!z) return;
    e.preventDefault(); const id = dragId; dragId = null; clear();
    const t = allTasks().find((x) => x.id === id); const day = z.dataset.dropDay; if (!t) return;
    const from = taskDay(t); if ((from || "") === day) return;
    const before = { start: t.start, due: t.due, allDay: t.allDay };
    if (!day) Object.assign(t, { start: null, due: null, allDay: false });
    else if (from) { const n = diffDays(day) - diffDays(from); Object.assign(t, { start: moveDays(t.start, n), due: moveDays(t.due, n) }); }
    else { const iso = new Date(day + "T00:00").toISOString(); Object.assign(t, { start: iso, due: iso, allDay: true }); }
    pending.set(t.id, { start: t.start, due: t.due, allDay: t.allDay });
    if (day && state.agenda.scale === "mes") state.agenda.selDay = day;
    renderAgenda();
    const ok = await setDate(t, null, day); pending.delete(t.id);
    if (!ok) { Object.assign(t, before); renderAgenda(); }
  });
}

const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export function bindAgenda({ complete, postpone, setDate }) {
  const ESC = ["lista", "semana", "mes"];
  state.agenda.scale = [pref("agendaScale"), state.cfg?.agenda?.escala, "lista"].find((x) => ESC.includes(x));
  loadFilters();
  $$("[data-scale]").forEach((b) => b.addEventListener("click", () => { state.agenda.scale = pref("agendaScale", b.dataset.scale); state.agenda.ref = new Date(); renderAgenda(); }));
  $(".cal-nav").addEventListener("click", (e) => { const btn = e.target.closest("button[data-step]"); if (btn) step(Number(btn.dataset.step)); });
  const view = $('.view[data-view="agenda"]');
  view.addEventListener("click", (e) => {
    const act = e.target.closest("button[data-act]");
    if (act) {
      const t = allTasks().find((x) => x.id === act.closest("[data-task]")?.dataset.task); if (!t) return;
      const row = act.closest(".ag-item"); row?.classList.add("is-leaving");
      Promise.resolve(complete({ id: t.id, projectId: t.projectId }, act)).then((ok) => { if (!ok) row?.classList.remove("is-leaving"); });
      return;
    }
    const f = e.target.closest("[data-foco]");
    if (f) { F.foco = F.foco === f.dataset.foco && f.closest("#ag-radar") ? "tudo" : f.dataset.foco; saveFilters(); renderAgenda(); return; }
    const g = e.target.closest("[data-goto]"); if (g) { goto(g.dataset.goto); return; }
    const fm = e.target.closest("[data-fmat]"); if (fm) { F.mats = toggle(F.mats, fm.dataset.fmat); saveFilters(); renderAgenda(); return; }
    const fl = e.target.closest("[data-flist]"); if (fl) { F.listas = toggle(F.listas, fl.dataset.flist); saveFilters(); renderAgenda(); return; }
    if (e.target.closest("[data-clear]")) { Object.assign(F, { foco: "tudo", listas: [], mats: [], feitas: false, q: "" }); saveFilters(); renderAgenda(); return; }
    const c = e.target.closest(".mcell[data-day]");
    if (c && c.classList.contains("is-out")) { goto(c.dataset.day); return; }
    if (c) { state.agenda.selDay = c.dataset.day; $$(".mcell").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.day === state.agenda.selDay))); renderDay(); }
  });
  bindDrag(view, setDate);
  view.addEventListener("input", (e) => { if (e.target.id === "ag-q") { F.q = e.target.value; renderAgenda(); } });
  view.addEventListener("change", (e) => { if (e.target.id === "ag-feitas") { F.feitas = e.target.checked; saveFilters(); renderAgenda(); } });
  view.addEventListener("toggle", (e) => { if (e.target.matches?.(".ag-nodate")) pref("agendaSemData", e.target.open); }, true);
  document.addEventListener("keydown", (e) => {
    if (taskOpen()) return;
    if (state.view !== "agenda" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest("input, textarea, select")) { if (e.key === "Escape" && e.target.id === "ag-q") { F.q = ""; e.target.blur(); renderAgenda(); } return; }
    const k = e.key.toLowerCase();
    if (k === "/") { e.preventDefault(); $("#ag-q")?.focus(); }
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
    else if (k === "t") { step(0); if (state.agenda.scale === "lista") goto(todayKey()); }
    else if (k === "l" || k === "s" || k === "m") { state.agenda.scale = pref("agendaScale", { l: "lista", s: "semana", m: "mes" }[k]); renderAgenda(); }
  });
}
