<img src="web/logo.svg" alt="" width="88">

# Hangar

Hub local do dia, em português, que roda na sua máquina (http://127.0.0.1:8023/) e junta:

- **TickTick**: o que vence hoje, o que ficou para trás, hábitos e a agenda da semana ou do mês;
- **GitHub**: cards atribuídos a você (com status e sprint de um GitHub Project) e PRs para revisar;
- **GLPI** (opcional): métricas de um servicedesk, só leitura;
- **um vault de notas** (Obsidian ou qualquer pasta de markdown): pendências soltas, quadro de ideias, a pauta do dia e o registro do foco;
- **Claude Code** (opcional): escreve a pauta do dia e sugere caminhos de melhoria a partir de tudo isso.

| Aba | O que mostra |
|---|---|
| **Hoje** | A pauta do dia (com checkboxes clicáveis), o que vence hoje, os cards e reviews e as pendências soltas |
| **Noite** | A noite em blocos até o horário de fim que você escolher. Enquanto você planeja, o início acompanha o relógio; **Começar agora** fixa o horário. Concluir um bloco fecha no horário real (terminou antes, o resto sobe; passou, o resto desce) e o bloco atual tem **+10 min**. Cada bloco tem o círculo de concluir e a duração; subir, descer e tirar aparecem ao passar o mouse. Clicar numa tarefa (aqui, na Agenda ou em Hoje) abre o mesmo painel de detalhes, que também encaixa a tarefa na noite ou tira dela |
| **Agenda** | Lista, semana ou mês do TickTick, com radar (atrasadas, hoje, próximos prazos), filtros por tipo, código e lista e busca. Cada item tem um círculo de concluir; clicar nele abre os detalhes (notas, checklist, datas, etiquetas), com adiar 1 dia ou 1 semana e o link para abrir no TickTick (`ticktick.url_tarefa`). O que conta como prazo é configurável em Ajustes → Agenda |
| **Trabalho** | Cards, PRs, pendências da área de trabalho e o painel do GLPI (o nome da aba é configurável) |
| **Ideias** | Quadro Ideia → Explorando → Proposta → Virou card (arraste entre colunas ou use as setas), com busca (`/`) e filtros por estágio e área, e o botão "Sugerir caminhos". Clicar numa ideia abre o painel de detalhes: problema, proposta, primeiro passo, notas, metadados e estágio, tudo editável (`E`), e as observações datadas (`#### Observações` com `- dd/mm: texto` na própria nota). Quando o campo Card cita `repo#123` (ou `dono/repo#123`; o dono padrão é `trabalho.github_org`), o Hangar lê no GitHub, só leitura, se esses cards já fecharam: com todos prontos, a ideia mostra "card pronto" e o botão **Fechar** (um por um ou "Fechar as N" na coluna), que grava `- **fechada**: dd/mm` e tira a ideia do quadro (desliga em Ajustes → `ideias.checar_cards`). Descartadas, fechadas e arquivadas (`- **arquivada**: dd/mm`) ficam fora do quadro até você marcar para mostrar; uma descartada pode ser excluída de vez da nota, com confirmação no próprio painel |
| **Foco** | Pomodoro configurável (tempos, ciclos, meta diária, som, notificação) e as estatísticas: hoje, semana, sequência, 28 dias e por área |
| **Ajustes** | Toda a configuração, sem editar arquivo, inclusive as cores (temas prontos ou três cores suas) e quais abas aparecem na barra lateral |

Atalhos: `1`–`7` trocam de aba, `R` sincroniza, `N` anota uma pendência, `Espaço` começa/pausa o foco. Na Agenda: `L`/`S`/`M` trocam a visão, `←`/`→` navegam, `T` volta para hoje e `/` busca.

## Requisitos

- Linux ou macOS com Python 3.10+ (só biblioteca padrão, nada para instalar com pip), `curl` e `xdg-open`/`open`.
- Opcionais, conforme as fontes que você ligar:
  - [TickTick](https://ticktick.com): pela **Open API oficial** (crie um app em [developer.ticktick.com](https://developer.ticktick.com) com Redirect URI `http://127.0.0.1:8023/oauth/ticktick`, cole Client ID e Secret em Ajustes, salve e clique em **Conectar TickTick**; ou cole um access token pronto). Sem token, cai para a sessão do app desktop. A Open API não tem hábitos;
  - [`gh`](https://cli.github.com) logado (`gh auth login`);
  - um GLPI com a API REST ligada (App-Token e token de usuário);
  - [Claude Code](https://claude.com/claude-code) (`claude` no PATH).

## Instalar

```bash
git clone https://github.com/luanotoni/hangar.git ~/Projetos/hangar
ln -s ~/Projetos/hangar/hangar ~/.local/bin/hangar   # ou qualquer pasta do seu PATH
hangar                                               # sobe o servidor e abre o navegador
```

Na primeira vez a página abre em **Ajustes**: preencha seu nome, a pasta do vault, ligue as fontes que você usa e salve. Para gerar a pauta todo dia sozinho (systemd do usuário):

```bash
hangar timer      # instala hangar-pauta.timer no horário escolhido em Ajustes
```

## Comandos

```
hangar              # sobe o servidor (se precisar) e abre o navegador
hangar noite        # abre direto na Noite
hangar ajustes      # abre direto nos Ajustes
hangar --no-open    # só sobe o servidor
hangar pauta        # gera a pauta de hoje no vault
hangar ideias "foco"  # gera sugestões de caminhos para um foco
hangar timer        # instala/atualiza o timer da pauta
hangar parar        # derruba o servidor
```

## Configuração

Tudo o que é seu fica fora do repositório:

| Arquivo | O quê |
|---|---|
| `~/.config/hangar/config.json` | Nome, perfil, áreas, vault, fontes, prompts, focos. A aba Ajustes lê e grava. Exemplo: [`config.example.json`](config.example.json) |
| `~/.config/hangar/hangar.env` | Segredos (URL e tokens do GLPI, token do TickTick), com permissão 600. Exemplo: [`.env.example`](.env.example) |
| `~/.local/share/hangar/` | Cache das fontes e as sessões da noite |
| `~/.local/state/hangar/server.log` | Log do servidor |

Ordem de prioridade: padrões do código → `config.json` → variáveis de ambiente. Qualquer chave pode vir do ambiente como `HANGAR_<SEÇÃO>_<CHAVE>` (por exemplo `HANGAR_VAULT_CAMINHO`, `HANGAR_TRABALHO_GITHUB_ORG`; listas em JSON). Uma chave definida pelo ambiente aparece travada na página. Atalhos: `HANGAR_PORT`, `HANGAR_VAULT`, `HANGAR_CONFIG` e `HANGAR_ENV_FILE`.

**Agenda:** a seção `agenda` decide como ler os títulos do TickTick. `regex_codigo` tira um código do início (o padrão lê `[CALC] Lista 3` como `CALC`; vazio desliga), `rotulo_codigo` dá o nome dos filtros (Matérias, Projetos, Clientes…). `palavras_prova` marcam o prazo forte, `nao_prova` desfazem (`refazer a prova` é estudo), `palavras_entrega` e `prioridade_entrega` marcam o prazo comum, e `ignorar` tira lembretes. As palavras casam no início de palavra, sem diferenciar acento nem maiúscula. `rotulo_prova` e `rotulo_entrega` levam `singular/plural`. No painel da tarefa dá para marcar o tipo à mão (prova, entrega ou nenhum): isso grava a etiqueta `etiqueta_prova`, `etiqueta_entrega` ou `etiqueta_nenhum` na tarefa do TickTick, que vale mais que as palavras. O mesmo painel edita o título e as notas.

Os tokens do GLPI podem vir de `HANGAR_GLPI_URL`, `HANGAR_GLPI_APP_TOKEN` e `HANGAR_GLPI_USER_TOKEN` (ambiente ou `hangar.env`), ou de um `.env` que você já tenha (`glpi.arquivo_credenciais` + `glpi.prefixo_credenciais`, lendo `<prefixo>BASE_URL`, `<prefixo>APP_TOKEN` e `<prefixo>USER_TOKEN`). Eles nunca vão para o navegador: a página só sabe se estão definidos.

## Como funciona

- `server.py` escuta só em 127.0.0.1 e recusa escrita sem o cabeçalho `X-Hangar` ou com outro Host/Origin.
- **Rápido por desenho:** cada fonte (`hub/store.py`) fica em memória e num snapshot em disco. A página recebe o último snapshot na hora, e o servidor busca de novo em segundo plano quando ele passa da validade (TickTick 90 s, GitHub 5 min, GLPI 15 min).
- **TickTick** (`hub/ticktick.py`): com `HANGAR_TICKTICK_TOKEN`, usa a Open API oficial (`/open/v1`); sem ele, a sessão do app desktop (`ticktick.sessao`, API interna, pode mudar sem aviso). Escreve só concluir tarefa, empurrar a data (1 ou 7 dias) e (só pela sessão do app) check-in de hábito.
- **GitHub** (`hub/github.py`): `gh api graphql`, só leitura. Status vem do campo `Status` do Project; a sprint é qualquer campo de iteração.
- **GLPI** (`hub/glpi.py`): só `GET /search/Ticket`. Grupos com o prefixo configurado (ex.: `Squad `) viram as equipes do gráfico.
- **Vault** (`hub/vault.py`): lê e escreve as notas de pendências, ideias e a pauta do dia (`AAAA-MM-DD - Pauta do dia.md`). As notas continuam editáveis à mão.
- **Claude** (`hub/claude.py`): o servidor monta o contexto e chama `claude -p --tools ""` (sem ferramentas, sem sessão salva). O Claude só lê o texto que recebe e devolve markdown ou JSON; quem grava no vault é o hub. Perfil, regras extras, seções da pauta e notas de contexto saem dos Ajustes.
- **Foco** (`hub/foco.py`): o relógio roda no navegador e sobrevive a recarregar a página. Cada bloco vira uma linha na nota do mês (`Hangar/Foco/AAAA-MM.md`), como `- 2026-11-19 14:05 · 25 min · #trabalho · Revisar o PR`; `12 de 25 min` é um bloco interrompido. As estatísticas saem só dessas notas, então editar à mão também conta.
- Teste fora de hora: `?agora=19:30` simula o relógio na aba Noite (os botões continuam escrevendo de verdade).

Design: marinho de cabine, azul de estrutura, laranja de sinal e branco, com Oxanium e Atkinson Hyperlegible Next servidas localmente em `web/fonts/` (SIL OFL 1.1).

## Licença

[MIT](LICENSE).
