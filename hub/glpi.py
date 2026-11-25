"""Métricas de um GLPI pela API REST, SOMENTE leitura (GET em /search/Ticket).

URL e tokens vêm de HANGAR_GLPI_URL, HANGAR_GLPI_APP_TOKEN e HANGAR_GLPI_USER_TOKEN (ambiente,
hangar.env ou o arquivo de credenciais da configuração) e nunca saem do servidor.
"""
import re
import statistics
import urllib.error
import urllib.parse
import urllib.request
import json
from datetime import datetime, timedelta

from . import config
from .store import SourceError

STATUS = {1: "Novo", 2: "Em atendimento", 3: "Planejado", 4: "Pendente", 5: "Solucionado", 6: "Fechado"}
FIELDS = {"2": "id", "1": "name", "12": "status", "15": "date", "17": "solvedate", "19": "date_mod",
          "7": "category", "8": "group", "65": "observer", "5": "tech", "3": "priority"}


def _env():
    env = {k: config.secret(k) for k in config.SECRET_KEYS if k.startswith("HANGAR_GLPI_")}
    if not all(env.values()):
        raise SourceError("Faltam a URL ou os tokens do GLPI. Preencha em Ajustes → GLPI.")
    return env


def _imported():
    rx = config.get()["glpi"]["regex_importados"].strip()
    try:
        return re.compile(rx) if rx else None
    except re.error:
        return None


def _is_imported(t, rx):
    return bool(rx and rx.search(t.get("name") or ""))


def _get(url, headers):
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        raise SourceError(f"O GLPI respondeu {e.code}. A sessão ou o App-Token podem ter mudado.") from e
    except (urllib.error.URLError, TimeoutError) as e:
        hint = config.get()["glpi"]["dica_rede"].strip()
        raise SourceError("Sem acesso ao GLPI." + (f" {hint}" if hint else "")) from e
    return json.loads(raw) if raw else None


def _dt(v):
    try:
        return datetime.strptime(v, "%Y-%m-%d %H:%M:%S") if v else None
    except ValueError:
        return None


def _list(v):
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x) for x in v if x]
    return [x for x in str(v).split("$#$") if x]


def fetch():
    env = _env()
    base = env["HANGAR_GLPI_URL"].rstrip("/")
    api = base if base.endswith("apirest.php") else base + "/apirest.php"
    web = api[: -len("/apirest.php")]
    h = {"App-Token": env["HANGAR_GLPI_APP_TOKEN"], "Content-Type": "application/json"}
    token = _get(api + "/initSession", {**h, "Authorization": "user_token " + env["HANGAR_GLPI_USER_TOKEN"]})
    s = {**h, "Session-Token": token["session_token"]}
    try:
        q = [("range", "0-1999"), ("sort", "15"), ("order", "ASC")]
        q += [("forcedisplay[]", k) for k in FIELDS]
        rows = (_get(api + "/search/Ticket?" + urllib.parse.urlencode(q), s) or {}).get("data") or []
    finally:
        try:
            _get(api + "/killSession", s)
        except SourceError:
            pass
    tickets = [{FIELDS[k]: v for k, v in r.items() if k in FIELDS} for r in rows]
    return summarize(tickets, web)


def _squad(t):
    """A equipe do chamado: o primeiro grupo (atribuído ou observador) com o prefixo configurado."""
    prefix = config.get()["glpi"]["prefixo_grupo"]
    for g in _list(t.get("group")) + _list(t.get("observer")):
        if not prefix:
            return g
        if g.lower().startswith(prefix.lower()):
            return g[len(prefix):].strip() or g
    return None


def summarize(tickets, web):
    now = datetime.now()
    rx = _imported()
    opened, solved, open_ = [], [], []
    for t in tickets:
        t["_date"], t["_solved"] = _dt(t.get("date")), _dt(t.get("solvedate"))
        st = int(t.get("status") or 0)
        if st in (1, 2, 3, 4):
            open_.append(t)
    by_status, by_area = {}, {}
    no_squad, no_tech = 0, 0
    for t in open_:
        name = STATUS.get(int(t["status"]), str(t["status"]))
        by_status[name] = by_status.get(name, 0) + 1
        sq = _squad(t)
        by_area[sq or ""] = by_area.get(sq or "", 0) + 1
        no_squad += sq is None
        no_tech += not _list(t.get("tech"))
    oldest = sorted((t for t in open_ if t["_date"]), key=lambda t: t["_date"])[:8]

    # séries semanais (8 semanas, começando na segunda) de abertos e solucionados
    monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    weeks = [monday - timedelta(weeks=i) for i in range(7, -1, -1)]
    series = []
    for w in weeks:
        e = w + timedelta(weeks=1)
        series.append({"week": w.strftime("%Y-%m-%d"),
                       "opened": sum(1 for t in tickets if t["_date"] and w <= t["_date"] < e and not _is_imported(t, rx)),
                       "solved": sum(1 for t in tickets if t["_solved"] and w <= t["_solved"] < e)})

    # tempo até solução (dias) dos chamados nascidos no GLPI, solucionados nos últimos 30 dias
    recent = [t for t in tickets if t["_solved"] and t["_date"] and t["_solved"] >= now - timedelta(days=30)
              and not _is_imported(t, rx)]
    durs = sorted((t["_solved"] - t["_date"]).total_seconds() / 86400 for t in recent)
    solve = None
    if durs:
        solve = {"n": len(durs), "median": round(statistics.median(durs), 1),
                 "p80": round(durs[min(len(durs) - 1, int(len(durs) * 0.8))], 1)}

    return {
        "total": len(tickets), "open": len(open_), "noSquad": no_squad, "noTech": no_tech,
        "byStatus": by_status, "byArea": dict(sorted(by_area.items(), key=lambda kv: -kv[1])),
        "opened7": sum(1 for t in tickets if t["_date"] and t["_date"] >= now - timedelta(days=7) and not _is_imported(t, rx)),
        "solved7": sum(1 for t in tickets if t["_solved"] and t["_solved"] >= now - timedelta(days=7)),
        "solveDays": solve, "series": series,
        "oldest": [{"id": t["id"], "name": (t.get("name") or "")[:110], "status": STATUS.get(int(t["status"]), ""),
                    "ageDays": (now - t["_date"]).days, "squad": _squad(t),
                    "imported": _is_imported(t, rx),
                    "url": f"{web}/front/ticket.form.php?id={t['id']}"} for t in oldest],
    }
