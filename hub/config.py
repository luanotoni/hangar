"""Configuração do Hangar: padrões < config.json < variáveis de ambiente.

- `~/.config/hangar/config.json` (ou `$HANGAR_CONFIG`) guarda tudo o que não é segredo. A aba
  Ajustes da página lê e grava esse arquivo.
- Qualquer chave pode ser sobrescrita por ambiente: `HANGAR_<SEÇÃO>_<CHAVE>` em maiúsculas
  (ex.: `HANGAR_VAULT_CAMINHO`, `HANGAR_TRABALHO_GITHUB_ORG`). Listas e objetos vão em JSON.
  Uma chave vinda do ambiente aparece travada na página.
- Segredos (tokens do GLPI e do TickTick) ficam só no ambiente ou em `~/.config/hangar/hangar.env` (0600),
  nunca no config.json e nunca voltam para o navegador.
"""
import copy
import json
import os
import threading
from pathlib import Path

_xdg = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
CONFIG_DIR = _xdg / "hangar"
CONFIG_FILE = Path(os.environ.get("HANGAR_CONFIG", CONFIG_DIR / "config.json")).expanduser()
SECRETS_FILE = Path(os.environ.get("HANGAR_ENV_FILE", CONFIG_DIR / "hangar.env")).expanduser()

DEFAULTS = {
    "usuario": {
        "nome": "",
        "perfil": "",  # quem você é e o que faz: entra no prompt da pauta e das ideias
    },
    "servidor": {"porta": 8023},
    "fuso": "America/Sao_Paulo",
    "areas": [  # etiquetas das pendências soltas; a primeira é a padrão
        {"id": "trabalho", "nome": "Trabalho"},
        {"id": "estudo", "nome": "Estudo"},
        {"id": "pessoal", "nome": "Pessoal"},
    ],
    "aparencia": {
        "tema": "cabine",  # um dos temas prontos (web/js/core.js → TEMAS) ou "personalizado"
        "fundo": "",  # cores-semente em hex; vazio = as do tema
        "estrutura": "",
        "destaque": "",
        "abas_ocultas": [],  # abas fora da barra lateral (ex.: ["ideias"]); Ajustes nunca some
    },
    "noite": {"ativo": True, "titulo": "A noite", "fim": "23:00"},
    "vault": {
        "caminho": "",  # pasta do vault do Obsidian (ou qualquer pasta de markdown)
        "pendencias": "Hangar/Pendências soltas.md",
        "ideias": "Hangar/Ideias e melhorias.md",
        "conversas": "Hangar/Pautas",
        "registro": "",  # nota-índice onde cada pauta nova ganha um link (opcional)
        "foco": "Hangar/Foco",  # pasta das notas mensais do pomodoro
    },
    "foco": {  # pomodoro; tempos em minutos
        "ativo": True,
        "minutos": 25,
        "pausa_curta": 5,
        "pausa_longa": 15,
        "ciclos": 4,  # blocos de foco até a pausa longa
        "meta_diaria": 8,  # blocos completos por dia
        "auto_pausa": True,  # a pausa começa sozinha quando o foco acaba
        "auto_foco": False,  # o foco seguinte começa sozinho quando a pausa acaba
        "hora_extra": True,  # o foco segue contando depois do tempo até você concluir
        "som": True,
        "aviso": True,  # notificação do navegador
    },
    "ticktick": {
        "ativo": True,
        "sessao": "~/.config/ticktick/config.json",
        # link de "Abrir no TickTick": {id} = tarefa, {projeto} = lista (Dida365: troque o domínio)
        "url_tarefa": "https://ticktick.com/webapp/#p/{projeto}/tasks/{id}",
    },
    "agenda": {  # aba Agenda: como ler prazos nos títulos do TickTick
        "escala": "lista",  # lista | semana | mes (a última escolhida no navegador vale mais)
        "semanas_lista": 4,
        "dias_radar": 21,  # janela de "próximos prazos"
        "regex_codigo": r"^\[([^\]]{1,12})\]\s*",  # 1º grupo = código (matéria, projeto, cliente); vazio = sem códigos
        "rotulo_codigo": "Matérias",
        "palavras_prova": ["prova", "exame"],  # início de palavra, sem diferenciar acento nem maiúscula
        "nao_prova": ["refazer", "revis", "leve"],  # se aparecer junto, não é prova
        "palavras_entrega": ["entrega", "trabalho", "questionario", "atividade avaliativa", "apresenta"],
        "ignorar": ["levar:"],  # títulos com isto nunca são prazo (ex.: lembretes)
        "prioridade_entrega": 3,  # prioridade do TickTick (1 baixa, 3 média, 5 alta) que já conta como entrega; 0 = não usar
        "rotulo_prova": "prova/provas",  # singular/plural
        "rotulo_entrega": "entrega/entregas",
        # marcação manual pelo painel da tarefa: vira etiqueta no TickTick e vale mais que as palavras
        "etiqueta_prova": "prova",
        "etiqueta_entrega": "entrega",
        "etiqueta_nenhum": "sem-prazo",
    },
    "trabalho": {
        "ativo": False,
        "nome": "Trabalho",
        "subtitulo": "",
        "area": "trabalho",  # área das pendências que aparece na aba de trabalho
        "github_org": "",  # vazio = todos os repositórios a que você tem acesso
        "projeto": 0,  # número do GitHub Project (v2) dos cards; 0 = o primeiro que o card tiver
        "prefixos_repo": [],  # prefixos tirados do nome do repo na lista de PRs
    },
    "glpi": {
        "ativo": False,
        "nome": "GLPI",
        "arquivo_credenciais": "",  # .env existente de onde ler URL e tokens (opcional)
        "prefixo_credenciais": "GLPI_",  # chaves <prefixo>BASE_URL, APP_TOKEN, USER_TOKEN no arquivo
        "prefixo_grupo": "",  # ex.: "Squad " — só grupos com esse prefixo contam como equipe
        "rotulo_grupo": "grupo",
        "regex_importados": "",  # títulos que casam ficam fora das séries (chamados migrados)
        "nota_importados": "",
        "dica_rede": "",  # mensagem quando o GLPI não responde (ex.: só abre pela VPN)
    },
    "claude": {
        "ativo": True,
        "binario": "",  # vazio = `claude` do PATH
        "modelo": "sonnet",
        "horario_pauta": "07:30",
        "regras_pauta": [],
        "secoes_pauta": ["Foco de hoje", "Trabalho", "Estudo", "Pessoal", "Não esquecer", "Uma ideia pra hoje"],
        "contexto_ideias": "",
        "notas_contexto": [],  # globs de notas extras (lembretes, regras) que entram no contexto da pauta
        "notas_ideias": [],  # notas extras que entram só no contexto das ideias
    },
    "ideias": {
        "areas": ["Produto", "Processo", "Infra", "Time"],
        "foco_padrao": "melhorias gerais no meu trabalho",
        "focos": [],  # [{"rotulo": "...", "foco": "..."}]
        "mostrar_descartadas": False,  # padrão do quadro; o que você marcar na aba fica lembrado no navegador
    },
}

SECRET_KEYS = ("HANGAR_GLPI_URL", "HANGAR_GLPI_APP_TOKEN", "HANGAR_GLPI_USER_TOKEN",
               "HANGAR_TICKTICK_CLIENT_ID", "HANGAR_TICKTICK_CLIENT_SECRET", "HANGAR_TICKTICK_TOKEN")
_ALIASES = {"HANGAR_VAULT": ("vault", "caminho"), "HANGAR_PORT": ("servidor", "porta"),
            "ROTA23_PORT": ("servidor", "porta")}

_lock = threading.Lock()
_cache = {"mtime": None, "data": None, "env": None}


def _env_name(path):
    return "HANGAR_" + "_".join(p.upper() for p in path)


def _cast(raw, default):
    if isinstance(default, bool):
        return raw.strip().lower() in ("1", "true", "sim", "yes", "on")
    if isinstance(default, int):
        return int(raw)
    if isinstance(default, (list, dict)):
        return json.loads(raw)
    return raw


def _merge(base, over):
    for k, v in (over or {}).items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            _merge(base[k], v)
        elif k in base:
            base[k] = v
    return base


def _leaves(d, prefix=()):
    for k, v in d.items():
        if isinstance(v, dict):
            yield from _leaves(v, prefix + (k,))
        else:
            yield prefix + (k,), v


def _set(d, path, value):
    for p in path[:-1]:
        d = d[p]
    d[path[-1]] = value


def _from_env(cfg):
    locked = []
    for alias, path in _ALIASES.items():
        if os.environ.get(alias) and not os.environ.get(_env_name(path)):
            os.environ[_env_name(path)] = os.environ[alias]
    for path, default in list(_leaves(DEFAULTS)):
        raw = os.environ.get(_env_name(path))
        if raw is None:
            continue
        try:
            _set(cfg, path, _cast(raw, default))
            locked.append(".".join(path))
        except (ValueError, json.JSONDecodeError):
            pass
    return locked


def file_config():
    try:
        return json.loads(CONFIG_FILE.read_text())
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        raise RuntimeError(f"Não consegui ler {CONFIG_FILE}: {e}") from e


def get():
    """A configuração efetiva (recarrega sozinha quando o arquivo muda)."""
    try:
        mtime = CONFIG_FILE.stat().st_mtime
    except OSError:
        mtime = 0
    with _lock:
        if _cache["data"] is None or _cache["mtime"] != mtime:
            cfg = _merge(copy.deepcopy(DEFAULTS), file_config())
            _cache["env"] = _from_env(cfg)
            _cache["data"], _cache["mtime"] = cfg, mtime
        return _cache["data"]


def locked():
    get()
    return list(_cache["env"] or [])


def exists():
    return CONFIG_FILE.exists()


def path(value):
    """Caminho do config com ~ expandido; relativo ao vault quando não é absoluto."""
    p = Path(os.path.expandvars(str(value))).expanduser()
    return p


def vault_path(rel):
    base = vault_root()
    if not rel:
        return None
    p = path(rel)
    return p if p.is_absolute() else base / p


def vault_root():
    v = get()["vault"]["caminho"]
    return path(v) if v else Path.home() / "Hangar"


def _clean(over, base):
    """Mantém só chaves conhecidas, com o tipo do padrão."""
    out = {}
    for k, v in over.items():
        if k not in base:
            continue
        d = base[k]
        if isinstance(d, dict):
            if isinstance(v, dict):
                out[k] = _clean(v, d)
        elif isinstance(d, bool):
            out[k] = bool(v)
        elif isinstance(d, int):
            out[k] = int(v)
        elif isinstance(d, list):
            if not isinstance(v, list):
                raise ValueError(f"{k} precisa ser uma lista")
            out[k] = v
        else:
            out[k] = str(v)
    return out


def save(new):
    """Grava o config.json (só chaves conhecidas). Chaves travadas pelo ambiente não mudam."""
    data = _clean(new, DEFAULTS)
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    cur = file_config()
    merged = _merge(_merge(copy.deepcopy(DEFAULTS), cur), data)
    tmp = CONFIG_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(CONFIG_FILE)
    with _lock:
        _cache["data"] = None
    return get()


# ---------- segredos ----------

def _read_env_file(p):
    env = {}
    try:
        for line in p.read_text().splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip().removeprefix("export ").strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return env


def secret(key):
    """Segredo do ambiente, do hangar.env ou (GLPI) do arquivo de credenciais do config."""
    if os.environ.get(key):
        return os.environ[key]
    v = _read_env_file(SECRETS_FILE).get(key)
    if v:
        return v
    g = get()["glpi"]
    if g["arquivo_credenciais"] and key.startswith("HANGAR_GLPI_"):
        suffix = {"URL": "BASE_URL"}.get(key[len("HANGAR_GLPI_"):], key[len("HANGAR_GLPI_"):])
        return _read_env_file(path(g["arquivo_credenciais"])).get(g["prefixo_credenciais"] + suffix) or ""
    return ""


def secrets_status():
    return {k: bool(secret(k)) for k in SECRET_KEYS}


def save_secrets(values):
    """Atualiza o hangar.env (0600). Valor vazio mantém o que já existe; None apaga."""
    cur = _read_env_file(SECRETS_FILE)
    for k, v in values.items():
        if k not in SECRET_KEYS:
            continue
        if v is None:
            cur.pop(k, None)
        elif str(v).strip():
            cur[k] = str(v).strip().replace("\n", "")
    SECRETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(SECRETS_FILE.with_suffix(".tmp"), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("# Segredos do Hangar (não versionar)\n" + "".join(f"{k}={v}\n" for k, v in cur.items()))
    SECRETS_FILE.with_suffix(".tmp").replace(SECRETS_FILE)
    os.chmod(SECRETS_FILE, 0o600)


def public():
    """O que a página pode ver: a config efetiva, as chaves travadas e quais segredos existem."""
    return {"config": get(), "locked": locked(), "secrets": secrets_status(), "exists": exists(),
            "file": str(CONFIG_FILE), "secretsFile": str(SECRETS_FILE)}
