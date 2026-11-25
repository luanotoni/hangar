// Aba Ajustes: edita o config.json e os segredos (GLPI, TickTick), que nunca voltam para a página.
import { $, $$, state, esc, TEMAS, themeSeeds, applyTheme } from "./core.js";

// tipos: text, textarea, number, bool, time, lines (uma por linha), areas (um nome por linha),
// focos ("Rótulo | foco" por linha), secret (só escrita), tema (temas prontos + 3 cores), abas (quais aparecem)
const SCHEMA = [
  ["Você", [
    ["usuario.nome", "Seu nome", "text", "Como a pauta e as ideias chamam você."],
    ["usuario.perfil", "Quem você é", "textarea", "Uma ou duas frases sobre o seu trabalho e a sua rotina. Entra no prompt da pauta e das ideias."],
    ["fuso", "Fuso horário", "text", "Formato IANA, ex.: America/Sao_Paulo."],
    ["areas", "Áreas das pendências", "areas", "Uma por linha. A etiqueta no vault é o nome em minúsculas, sem acento (ex.: Estudo → #estudo)."],
  ]],
  ["Aparência", [
    ["aparencia.tema", "Cores", "tema", "Escolha um tema pronto ou ajuste as três cores. A página muda na hora; salve para manter. O brilho de cada cor é corrigido sozinho para o texto continuar legível."],
    ["aparencia.abas_ocultas", "Abas na barra lateral", "abas", "Desmarque o que você não usa. Ajustes sempre fica; os atalhos numéricos seguem a ordem das abas visíveis."],
  ]],
  ["Vault", [
    ["vault.caminho", "Pasta do vault", "text", "Pasta de notas markdown (um vault do Obsidian serve). Vazio = ~/Hangar."],
    ["vault.pendencias", "Nota das pendências soltas", "text", "Relativo ao vault."],
    ["vault.ideias", "Nota das ideias", "text", "Relativo ao vault."],
    ["vault.conversas", "Pasta das pautas", "text", "Onde cada pauta do dia vira uma nota."],
    ["vault.registro", "Nota-índice (opcional)", "text", "Cada pauta nova ganha um link aqui, se a nota existir."],
    ["vault.foco", "Pasta do foco", "text", "Uma nota por mês (AAAA-MM.md) com uma linha por bloco de foco."],
  ]],
  ["TickTick e noite", [
    ["ticktick.ativo", "Ler o TickTick", "bool", "Pela Open API oficial quando há token; senão, pela sessão do app desktop."],
    ["secret:HANGAR_TICKTICK_CLIENT_ID", "Client ID (Open API)", "secret", "developer.ticktick.com → Manage Apps → New App. Redirect URI: http://127.0.0.1:8023/oauth/ticktick"],
    ["secret:HANGAR_TICKTICK_CLIENT_SECRET", "Client Secret (Open API)", "secret", "Salve os dois e clique em Conectar TickTick logo abaixo."],
    ["oauth:ticktick", "Conectar TickTick", "oauth", "Abre o login do TickTick e grava o token no hangar.env."],
    ["secret:HANGAR_TICKTICK_TOKEN", "Ou cole um access token", "secret", "Se você já tem um token da Open API."],
    ["ticktick.sessao", "Arquivo da sessão do app (sem token)", "text", "Caminho antigo, só se não houver token."],
    ["ticktick.url_tarefa", "Link para abrir uma tarefa", "text", "Usado em Abrir no TickTick. {id} = tarefa, {projeto} = lista. Quem usa o Dida365 troca o domínio."],
    ["noite.ativo", "Mostrar a aba Noite", "bool", ""],
    ["noite.titulo", "Título da noite", "text", ""],
    ["noite.fim", "A noite acaba às", "time", ""],
  ]],
  ["Agenda", [
    ["agenda.escala", "Visão inicial", "text", "lista, semana ou mes. A última que você escolher na aba fica lembrada neste navegador."],
    ["agenda.semanas_lista", "Semanas na visão Lista", "number", ""],
    ["agenda.dias_radar", "Dias à frente nos próximos prazos", "number", "Janela do radar no topo da agenda."],
    ["agenda.regex_codigo", "Código no início do título (regex)", "text", "O 1º grupo vira uma etiqueta filtrável. O padrão lê [CALC] Lista 3 como CALC. Vazio = sem códigos."],
    ["agenda.rotulo_codigo", "Nome dos códigos", "text", "Ex.: Matérias, Projetos, Clientes."],
    ["agenda.rotulo_prova", "Nome do prazo forte", "text", "singular/plural. Ex.: prova/provas, entrega final/entregas finais."],
    ["agenda.palavras_prova", "Palavras que marcam o prazo forte", "lines", "Uma por linha, início de palavra, sem ligar para acento ou maiúscula."],
    ["agenda.nao_prova", "Palavras que desfazem o prazo forte", "lines", "Ex.: refazer (\"refazer a prova\" é estudo, não prova)."],
    ["agenda.rotulo_entrega", "Nome do prazo comum", "text", "singular/plural."],
    ["agenda.palavras_entrega", "Palavras que marcam o prazo comum", "lines", ""],
    ["agenda.prioridade_entrega", "Prioridade que já conta como prazo", "number", "Do TickTick: 1 baixa, 3 média, 5 alta. 0 = não usar."],
    ["agenda.ignorar", "Títulos que nunca são prazo", "lines", "Trechos. Ex.: levar: (lembretes do que levar a algum lugar)."],
    ["agenda.etiqueta_prova", "Etiqueta para marcar prova à mão", "text", "O botão Tipo no painel da tarefa grava esta etiqueta no TickTick. Ela vale mais que as palavras."],
    ["agenda.etiqueta_entrega", "Etiqueta para marcar entrega à mão", "text", ""],
    ["agenda.etiqueta_nenhum", "Etiqueta para dizer que não é prazo", "text", "Tira uma tarefa do radar mesmo que o título case com as palavras."],
  ]],
  ["Trabalho no GitHub", [
    ["trabalho.ativo", "Ler cards e PRs do GitHub", "bool", "Usa o gh CLI já logado (gh auth login)."],
    ["trabalho.nome", "Nome da aba", "text", "Ex.: o nome da empresa ou do time."],
    ["trabalho.subtitulo", "Subtítulo", "text", "Aparece quando o card não tem sprint."],
    ["trabalho.github_org", "Organização no GitHub", "text", "Vazio = todos os repositórios a que você tem acesso."],
    ["trabalho.projeto", "Número do GitHub Project", "number", "De onde saem status e sprint dos cards. 0 = o primeiro projeto do card."],
    ["trabalho.area", "Área das pendências desta aba", "text", "A etiqueta (ex.: trabalho)."],
    ["trabalho.prefixos_repo", "Prefixos para encurtar repos", "lines", "Tirados do nome do repositório na lista de PRs."],
  ]],
  ["GLPI", [
    ["glpi.ativo", "Ler um GLPI", "bool", "Só leitura, pela API REST (apirest.php)."],
    ["glpi.nome", "Título do painel", "text", ""],
    ["secret:HANGAR_GLPI_URL", "URL do GLPI", "secret", "Ex.: https://glpi.exemplo.com"],
    ["secret:HANGAR_GLPI_APP_TOKEN", "App-Token", "secret", ""],
    ["secret:HANGAR_GLPI_USER_TOKEN", "User token", "secret", "Preferências do usuário → Chaves de acesso remoto."],
    ["glpi.arquivo_credenciais", "Ou ler de um .env existente", "text", "Opcional: usa <prefixo>BASE_URL, <prefixo>APP_TOKEN e <prefixo>USER_TOKEN desse arquivo."],
    ["glpi.prefixo_credenciais", "Prefixo das chaves nesse .env", "text", ""],
    ["glpi.rotulo_grupo", "Como chamar o grupo", "text", "Ex.: squad, equipe, fila."],
    ["glpi.prefixo_grupo", "Prefixo dos grupos que contam", "text", "Ex.: \"Squad \". Vazio = o primeiro grupo do chamado."],
    ["glpi.regex_importados", "Regex de chamados importados", "text", "Títulos que casam ficam fora das séries e do tempo até a solução."],
    ["glpi.nota_importados", "Nota sobre os importados", "text", ""],
    ["glpi.dica_rede", "Dica quando o GLPI não responde", "text", "Ex.: só abre pela VPN."],
  ]],
  ["Claude", [
    ["claude.ativo", "Usar o Claude Code", "bool", "Gera a pauta e as ideias com `claude -p`, sem ferramentas."],
    ["claude.binario", "Caminho do claude", "text", "Vazio = o do PATH."],
    ["claude.modelo", "Modelo", "text", "Ex.: sonnet, opus, haiku."],
    ["claude.horario_pauta", "Horário da pauta automática", "time", "Depois de salvar, rode `hangar timer` para (re)instalar o timer."],
    ["claude.secoes_pauta", "Seções da pauta", "lines", "Uma por linha; a primeira sempre aparece."],
    ["claude.regras_pauta", "Regras extras da pauta", "lines", "Uma por linha. Ex.: o que não é tarefa sua."],
    ["claude.notas_contexto", "Notas extras no contexto", "lines", "Globs de notas (relativos ao vault ou absolutos) com lembretes e regras."],
    ["claude.contexto_ideias", "Contexto para as ideias", "textarea", "O que vale saber ao sugerir melhorias (stack, limites, ferramentas)."],
    ["claude.notas_ideias", "Notas de referência das ideias", "lines", "Globs de notas lidas só ao sugerir ideias."],
  ]],
  ["Foco (pomodoro)", [
    ["foco.ativo", "Mostrar a aba Foco", "bool", ""],
    ["foco.minutos", "Minutos de foco", "number", "Um bloco. O clássico é 25."],
    ["foco.pausa_curta", "Pausa curta (min)", "number", ""],
    ["foco.pausa_longa", "Pausa longa (min)", "number", ""],
    ["foco.ciclos", "Focos até a pausa longa", "number", ""],
    ["foco.meta_diaria", "Meta de blocos por dia", "number", "0 = sem meta."],
    ["foco.hora_extra", "Seguir contando depois do tempo", "bool", "Quando o foco acaba, o relógio continua (+MM:SS) até você concluir, e o bloco entra com os minutos reais. Desligado, o foco fecha sozinho no tempo marcado."],
    ["foco.auto_pausa", "Começar a pausa sozinha", "bool", "Quando o foco acaba (ou quando você conclui o tempo extra)."],
    ["foco.auto_foco", "Começar o foco seguinte sozinho", "bool", "Quando a pausa acaba."],
    ["foco.som", "Tocar um som no fim", "bool", ""],
    ["foco.aviso", "Notificação do navegador", "bool", "Só aparece com a aba em segundo plano. O navegador pede permissão no primeiro Começar."],
  ]],
  ["Ideias", [
    ["ideias.areas", "Áreas das ideias", "lines", ""],
    ["ideias.foco_padrao", "Foco padrão", "text", ""],
    ["ideias.focos", "Focos prontos", "focos", "Um por linha: Rótulo | foco completo."],
    ["ideias.mostrar_descartadas", "Mostrar as descartadas no quadro", "bool", "Padrão da aba Ideias. O que você marcar lá fica lembrado neste navegador."],
    ["ideias.checar_cards", "Ver se o card da ideia já fechou", "bool", "Lê no GitHub (pelo gh, só leitura) as referências repo#123 do campo Card. Quando todas fecharam, a ideia mostra 'card pronto' e o botão Fechar."],
  ]],
];

const get = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
function set(o, path, v) { const ks = path.split("."); let cur = o; ks.slice(0, -1).forEach((k) => { cur = cur[k] ||= {}; }); cur[ks.at(-1)] = v; }
export const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "");

function value(type, v) {
  if (type === "lines") return (v || []).join("\n");
  if (type === "areas") return (v || []).map((a) => a.nome).join("\n");
  if (type === "focos") return (v || []).map((f) => `${f.rotulo} | ${f.foco}`).join("\n");
  return v ?? "";
}
function parse(type, raw, checked) {
  const lines = () => raw.split("\n").map((x) => x.trim()).filter(Boolean);
  if (type === "bool") return checked;
  if (type === "number") return Number(raw) || 0;
  if (type === "lines") return lines();
  if (type === "areas") return lines().map((n) => ({ id: slug(n), nome: n }));
  if (type === "focos") return lines().map((l) => { const [r, ...f] = l.split("|"); return { rotulo: r.trim(), foco: (f.join("|").trim() || r.trim()) }; });
  return raw;
}

function field([path, label, type, help], cfg, locked, secrets) {
  const id = "cfg-" + path.replace(/[^\w]/g, "-");
  const lock = locked.includes(path);
  const dis = lock ? " disabled" : "";
  const hint = (lock ? "Definido por variável de ambiente; mude lá. " : "") + (help || "");
  const helpEl = hint ? `<p class="muted small" id="${id}-h">${esc(hint)}</p>` : "";
  const desc = hint ? ` aria-describedby="${id}-h"` : "";
  if (type === "bool") {
    return `<div class="cfg-f cfg-bool"><label><input type="checkbox" id="${id}" data-path="${path}" data-type="bool"${get(cfg, path) ? " checked" : ""}${dis}${desc}> ${esc(label)}</label>${helpEl}</div>`;
  }
  if (type === "oauth") {
    const ok = secrets.HANGAR_TICKTICK_TOKEN;
    return `<div class="cfg-f"><a class="btn btn-ghost" id="${id}" href="/oauth/ticktick/start">${esc(label)}</a>${ok ? ` <span class="muted small">token já definido</span>` : ""}${helpEl}</div>`;
  }
  if (type === "tema") return themeField(id, get(cfg, "aparencia") || {}, helpEl);
  if (type === "abas") {
    const hidden = get(cfg, path) || [];
    const boxes = ABAS.map(([k, nome]) => `<label><input type="checkbox" data-aba="${k}"${hidden.includes(k) ? "" : " checked"}> ${esc(k === "trabalho" ? cfg.trabalho?.nome || nome : nome)}</label>`).join("");
    return `<fieldset class="cfg-f cfg-abas"><legend>${esc(label)}</legend><div class="cfg-checks">${boxes}</div>${helpEl}</fieldset>`;
  }
  if (type === "secret") {
    const key = path.slice(7); const has = secrets[key];
    return `<div class="cfg-f"><label for="${id}">${esc(label)}</label>
      <input id="${id}" type="password" autocomplete="off" data-secret="${key}" placeholder="${has ? "já definido; deixe vazio para manter" : "não definido"}"${desc}>${helpEl}</div>`;
  }
  const v = esc(value(type, get(cfg, path)));
  const input = ["textarea", "lines", "areas", "focos"].includes(type)
    ? `<textarea id="${id}" rows="${type === "textarea" ? 3 : 4}" data-path="${path}" data-type="${type}"${dis}${desc}>${v}</textarea>`
    : `<input id="${id}" type="${type === "number" ? "number" : type === "time" ? "time" : "text"}" value="${v}" data-path="${path}" data-type="${type}" autocomplete="off"${dis}${desc}>`;
  return `<div class="cfg-f"><label for="${id}">${esc(label)}</label>${input}${helpEl}</div>`;
}

const ABAS = [["hoje", "Hoje"], ["noite", "Noite"], ["agenda", "Agenda"], ["trabalho", "Trabalho"], ["ideias", "Ideias"], ["foco", "Foco"]];
const CORES = [["fundo", "Fundo"], ["estrutura", "Estrutura"], ["destaque", "Destaque"]];

function themeField(id, a, helpEl) {
  const seeds = themeSeeds(a);
  const cur = TEMAS[a.tema] || a.tema === "personalizado" ? a.tema : "cabine";
  const swatch = (s) => `<span class="sw" aria-hidden="true" style="--sw-f:${s.fundo};--sw-e:${s.estrutura};--sw-d:${s.destaque}"><i></i><i></i><i></i></span>`;
  const btn = (k, nome, s) => `<button type="button" class="tema" data-tema="${k}" aria-pressed="${k === cur}">${swatch(s)}${esc(nome)}</button>`;
  const presets = Object.entries(TEMAS).map(([k, t]) => btn(k, t.nome, t)).join("") + btn("personalizado", "Personalizado", seeds);
  const pickers = CORES.map(([k, nome]) =>
    `<label class="cor"><input type="color" data-path="aparencia.${k}" data-type="text" data-cor="${k}" value="${seeds[k]}"> ${nome}</label>`).join("");
  return `<fieldset class="cfg-f cfg-tema" id="${id}"><legend>Cores</legend>
    <input type="hidden" data-path="aparencia.tema" data-type="text" value="${cur}">
    <div class="temas" role="group" aria-label="Temas prontos">${presets}</div>
    <div class="cores">${pickers}</div>${helpEl}</fieldset>`;
}

/** Lê o tema dos campos e aplica na página (prévia antes de salvar). */
function previewTheme() {
  const tema = $('#cfg-form [data-path="aparencia.tema"]').value;
  const a = { tema }; $$("#cfg-form [data-cor]").forEach((el) => { a[el.dataset.cor] = el.value; });
  applyTheme(themeSeeds(a), false);
  $$("#cfg-form .tema").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tema === tema)));
  const sw = $('#cfg-form .tema[data-tema="personalizado"] .sw');
  if (sw) CORES.forEach(([k]) => sw.style.setProperty(`--sw-${k[0]}`, a[k]));
}

export function renderAjustes() {
  const c = state.cfgInfo; if (!c) return;
  if ($("#cfg-fields").dataset.ready) { previewTheme(); return; } // não apaga o que está sendo digitado
  $("#cfg-fields").dataset.ready = "1";
  $("#cfg-first").hidden = c.exists;
  $("#cfg-file").textContent = c.file;
  $("#cfg-fields").innerHTML = SCHEMA.map(([title, fields]) => `<fieldset class="panel cfg-group"><legend>${esc(title)}</legend>${fields.map((f) => field(f, c.config, c.locked, c.secrets)).join("")}</fieldset>`).join("");
}

export function bindAjustes({ save }) {
  $("#cfg-form").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tema]"); if (!b) return;
    const k = b.dataset.tema;
    $('#cfg-form [data-path="aparencia.tema"]').value = k;
    if (TEMAS[k]) $$("#cfg-form [data-cor]").forEach((el) => { el.value = TEMAS[k][el.dataset.cor]; });
    previewTheme();
  });
  $("#cfg-form").addEventListener("input", (e) => {
    if (!e.target.dataset.cor) return;
    $('#cfg-form [data-path="aparencia.tema"]').value = "personalizado";
    previewTheme();
  });
  $("#cfg-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const cfg = {}; const secrets = {};
    for (const el of $("#cfg-form").querySelectorAll("[data-path]:not(:disabled)")) set(cfg, el.dataset.path, parse(el.dataset.type, el.value, el.checked));
    for (const el of $("#cfg-form").querySelectorAll("[data-secret]")) if (el.value.trim()) secrets[el.dataset.secret] = el.value.trim();
    set(cfg, "aparencia.abas_ocultas", $$("#cfg-form [data-aba]").filter((el) => !el.checked).map((el) => el.dataset.aba));
    save({ config: cfg, secrets }, e.submitter).then((ok) => {
      if (!ok) return;
      $("#cfg-fields").dataset.ready = "";
      $("#cfg-status").textContent = "Salvo. As fontes vão ser lidas de novo.";
    });
  });
}
