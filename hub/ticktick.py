"""TickTick por dois caminhos, escolhidos sozinhos:

- **Open API oficial** (`api.ticktick.com/open/v1`), quando há `HANGAR_TICKTICK_TOKEN` (hangar.env ou
  ambiente). O token sai do login OAuth feito pela aba Ajustes ou é colado à mão. Não tem hábitos: esses
  continuam pela sessão do app quando ela existe.
- **Sessão do app desktop** (`ticktick.sessao`), o caminho antigo, quando não há token.

O token nunca sai do servidor. As leituras independentes rodam em paralelo.
"""
import base64
import json
import re
import secrets
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from . import config
from .store import SourceError

API = "https://api.ticktick.com/api/v2"
OPEN = "https://api.ticktick.com/open/v1"
OAUTH = "https://ticktick.com/oauth"
SCOPE = "tasks:read tasks:write"


def _token():
    return config.secret("HANGAR_TICKTICK_TOKEN")


def mode():
    return "api" if _token() else "app"


def _http(req, timeout=20):
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            hint = ("Gere um token novo em Ajustes (Conectar TickTick)." if mode() == "api"
                    else "Abra o app, confira o login e sincronize.")
            raise SourceError("O TickTick recusou o acesso. " + hint) from e
        raise SourceError(f"O TickTick respondeu {e.code}. Tente sincronizar de novo em instantes.") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise SourceError("Sem conexão com o TickTick. Confira a internet e sincronize.") from e
    return json.loads(raw) if raw else {}


def iso(v):
    """TickTick manda +0000 ou -0300 (a Open API usa o fuso da tarefa); vira Z ou -03:00, ISO de verdade."""
    if not isinstance(v, str):
        return None
    v = v.replace("+0000", "Z")
    return re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", v)


def tt_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000+0000")


def _task(t, done=False):
    items = t.get("items") or []
    out = {"done": done, "id": t["id"], "projectId": t["projectId"], "title": t.get("title", ""),
           "priority": t.get("priority", 0), "tags": t.get("tags") or [],
           "allDay": bool(t.get("isAllDay")), "start": iso(t.get("startDate") or (t.get("completedTime") if done else None)),
           "due": iso(t.get("dueDate")), "repeat": bool(t.get("repeatFlag")) and not done,
           "items": 0 if done else len(items), "itemsDone": 0 if done else sum(1 for i in items if i.get("status"))}
    note = (t.get("content") or t.get("desc") or "").strip()
    if note:
        out["content"] = note[:4000]
    if items and not done:
        out["checklist"] = [{"title": i.get("title", ""), "done": bool(i.get("status"))}
                            for i in sorted(items, key=lambda i: i.get("sortOrder", 0))]
    if done:
        out["completedAt"] = iso(t.get("completedTime"))
    return out


# ---------- Open API oficial ----------

def op(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Authorization": "Bearer " + _token(), "User-Agent": "hangar-local"}
    if body is not None:
        h["Content-Type"] = "application/json"
    return _http(urllib.request.Request(OPEN + path, data=data, method=method, headers=h))


def _api_fetch():
    raw = [p for p in op("GET", "/project") or [] if not p.get("closed")]
    projects = [{"id": "inbox", "name": "Entrada"}] + [{"id": p["id"], "name": p["name"]} for p in raw]

    def data(pid):
        try:
            return op("GET", f"/project/{pid}/data").get("tasks") or []
        except SourceError:
            if pid == "inbox":
                return []
            raise

    def completed():
        try:
            rows = op("POST", "/task/completed", {
                "projectIds": [p["id"] for p in projects if p["id"] != "inbox"],
                "startDate": (date.today() - timedelta(days=42)).strftime("%Y-%m-%dT00:00:00.000+0000"),
                "endDate": (date.today() + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00.000+0000")})
        except SourceError:
            return []
        return [_task(t, True) for t in rows or [] if isinstance(t, dict) and t.get("id")]

    with ThreadPoolExecutor(6) as ex:
        f_done, f_hab = ex.submit(completed), ex.submit(_habits)  # hábitos: só pela sessão do app, se houver
        lists = list(ex.map(data, [p["id"] for p in projects]))
    inbox_ids = {t.get("projectId") for t in lists[0]}
    for p in projects:  # o inbox real tem id "inboxNNN"; os cards apontam para ele
        if p["id"] == "inbox" and inbox_ids:
            p["id"] = next(iter(inbox_ids))
    tasks = [_task(t) for ts in lists for t in ts if t.get("status", 0) == 0]
    return {"projects": projects, "tasks": tasks + f_done.result(), "habits": f_hab.result(), "mode": "api"}


def _api_complete(body):
    op("POST", f"/project/{body['projectId']}/task/{body['id']}/complete")


def _api_postpone(body, days):
    obj = op("GET", f"/project/{body['projectId']}/task/{body['id']}")
    _shift(obj, days)
    op("POST", f"/task/{body['id']}", obj)


# ---------- sessão do app desktop ----------

def _session():
    try:
        cfg = json.loads(config.path(config.get()["ticktick"]["sessao"]).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SourceError("TickTick sem acesso: conecte a API em Ajustes (ou faça login no app desktop).") from e
    if not cfg.get("token"):
        raise SourceError("O app do TickTick está deslogado. Faça login nele e sincronize de novo.")
    return cfg


def _headers(cfg, json_body=False):
    device = {"platform": "electron", "os": "linux", "device": "Linux x64", "name": "hangar",
              "version": "8000", "id": cfg.get("deviceId", ""), "channel": "website",
              "campaign": "", "websocket": ""}
    h = {"Cookie": "t=" + cfg["token"], "X-Device": json.dumps(device),
         "traceid": secrets.token_hex(12), "x-tz": config.get()["fuso"], "hl": "pt_BR",
         "User-Agent": "Mozilla/5.0 hangar-local"}
    if json_body:
        h["Content-Type"] = "application/json"
    return h


def tt(method, path, body=None):
    cfg = _session()
    data = json.dumps(body).encode() if body is not None else None
    return _http(urllib.request.Request(API + path, data=data, method=method,
                                        headers=_headers(cfg, body is not None)))


def _open_tasks():
    d = tt("GET", "/batch/check/0")
    projects = [{"id": p["id"], "name": p["name"]} for p in d.get("projectProfiles") or []
                if not p.get("closed")]
    projects.insert(0, {"id": d.get("inboxId"), "name": "Entrada"})
    tasks = [_task(t) for t in d.get("syncTaskBean", {}).get("update", [])
             if not t.get("deleted") and t.get("status", 0) == 0]
    return projects, tasks


def _completed():
    q = urllib.parse.urlencode({"from": (date.today() - timedelta(days=42)).strftime("%Y-%m-%d 00:00:00"),
                                "to": (date.today() + timedelta(days=1)).strftime("%Y-%m-%d 00:00:00"),
                                "limit": 300})
    try:
        rows = tt("GET", "/project/all/completed/?" + q)
    except SourceError:
        return []
    return [_task(t, True) for t in rows if not t.get("deleted")]


def _habits():
    try:
        raw_h = [h for h in tt("GET", "/habits") if h.get("status", 0) == 0]
        today = int(date.today().strftime("%Y%m%d"))
        ck = tt("POST", "/habitCheckins/query",
                {"habitIds": [h["id"] for h in raw_h], "afterStamp": today - 1}).get("checkins", {})
    except SourceError:
        return None
    return [{"id": h["id"], "name": h["name"], "reminder": (h.get("reminders") or [None])[0],
             "done": any(c.get("checkinStamp") == today and c.get("status") == 2 for c in ck.get(h["id"], []))}
            for h in raw_h]


def _app_fetch():
    with ThreadPoolExecutor(3) as ex:
        f_open, f_done, f_hab = ex.submit(_open_tasks), ex.submit(_completed), ex.submit(_habits)
        projects, tasks = f_open.result()
        return {"projects": projects, "tasks": tasks + f_done.result(), "habits": f_hab.result(), "mode": "app"}


def _full_task(task_id, project_id):
    return tt("GET", f"/task/{task_id}?projectId={project_id}")


def _save_task(obj):
    r = tt("POST", "/batch/task", {"add": [], "update": [obj], "delete": []})
    err = (r or {}).get("id2error") or {}
    if err:
        raise SourceError("O TickTick não aceitou a mudança: " + json.dumps(err)[:200])


# ---------- operações (escolhem o caminho) ----------

def fetch():
    return _api_fetch() if mode() == "api" else _app_fetch()


def _shift(obj, days):
    """Empurra início e prazo em N dias, no objeto inteiro (update parcial apaga datas)."""
    for k in ("startDate", "dueDate"):
        v = obj.get(k)
        if v:
            fmt = "%Y-%m-%dT%H:%M:%S.%f%z" if "." in v else "%Y-%m-%dT%H:%M:%S%z"
            dt = datetime.strptime(v, fmt) + timedelta(days=days)
            obj[k] = dt.strftime("%Y-%m-%dT%H:%M:%S.000+0000")
    if not obj.get("dueDate"):
        raise SourceError("Essa tarefa não tem data para empurrar.")


def _parse(v):
    fmt = "%Y-%m-%dT%H:%M:%S.%f%z" if "." in v else "%Y-%m-%dT%H:%M:%S%z"
    return datetime.strptime(v, fmt)


def _fmt(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000+0000")


def _set_date(obj, body):
    """Põe a tarefa noutro dia. Sem "time": mantém o horário (ou o dia inteiro) e a duração.
    "time" "HH:MM" marca horário; "time" "" vira dia inteiro; "date" vazio tira a data."""
    day = body.get("date")
    if not day:
        for k in ("startDate", "dueDate"):
            obj.pop(k, None)
        obj["isAllDay"] = False
        obj["reminders"] = []
        return
    day = date.fromisoformat(day)
    tz = ZoneInfo(obj.get("timeZone") or config.get()["fuso"])
    start, due = (_parse(obj[k]) if obj.get(k) else None for k in ("startDate", "dueDate"))
    start = start or due
    dur = (due - start) if start and due else timedelta(0)
    time = body.get("time")
    if start and time is None:  # só o dia muda
        local = start.astimezone(tz)
        new = datetime.combine(day, local.time().replace(tzinfo=None)).replace(tzinfo=tz)
    elif time:
        h, m = (int(x) for x in time.split(":")[:2])
        new = datetime.combine(day, datetime.min.time()).replace(hour=h, minute=m, tzinfo=tz)
        if not start or obj.get("isAllDay"):
            dur = timedelta(0)
        obj["isAllDay"] = False
    else:  # dia inteiro
        new = datetime.combine(day, datetime.min.time()).replace(tzinfo=tz)
        if not start or not obj.get("isAllDay"):
            dur = timedelta(0)
        obj["isAllDay"] = True
    obj["startDate"], obj["dueDate"] = _fmt(new), _fmt(new + dur)
    obj.setdefault("timeZone", str(tz))


def complete_task(body):
    if mode() == "api":
        return _api_complete(body)
    obj = _full_task(body["id"], body["projectId"])
    obj["status"] = 2
    obj["completedTime"] = tt_now()
    _save_task(obj)


def postpone_task(body):
    days = int(body.get("days", 1))
    if mode() == "api":
        return _api_postpone(body, days)
    obj = _full_task(body["id"], body["projectId"])
    _shift(obj, days)
    _save_task(obj)


def _apply_edit(obj, body):
    """Só o que veio no corpo muda; o resto do objeto volta inteiro (update parcial apaga campos)."""
    if "title" in body:
        title = str(body["title"]).strip()
        if not title:
            raise SourceError("O título não pode ficar vazio.")
        obj["title"] = title[:500]
    if "content" in body:  # tarefa com checklist guarda a descrição em desc
        obj["desc" if obj.get("kind") == "CHECKLIST" else "content"] = str(body["content"])[:20000]
    if "tags" in body:
        tags = body["tags"]
        if not isinstance(tags, list) or not all(isinstance(t, str) and t.strip() for t in tags):
            raise SourceError("Etiquetas inválidas.")
        obj["tags"] = [t.strip() for t in tags][:50]


def update_task(body):
    if mode() == "api":
        obj = op("GET", f"/project/{body['projectId']}/task/{body['id']}")
        _apply_edit(obj, body)
        op("POST", f"/task/{body['id']}", obj)
        return
    obj = _full_task(body["id"], body["projectId"])
    _apply_edit(obj, body)
    _save_task(obj)


def date_task(body):
    if mode() == "api":
        obj = op("GET", f"/project/{body['projectId']}/task/{body['id']}")
        _set_date(obj, body)
        op("POST", f"/task/{body['id']}", obj)
        return
    obj = _full_task(body["id"], body["projectId"])
    _set_date(obj, body)
    _save_task(obj)


def checkin_habit(body):
    now = tt_now()  # a Open API não tem hábitos: sempre pela sessão do app
    stamp = int(date.today().strftime("%Y%m%d"))
    tt("POST", "/habitCheckins/batch", {"add": [{
        "id": secrets.token_hex(12), "habitId": body["habitId"], "checkinStamp": stamp,
        "checkinTime": now, "opTime": now, "value": 1.0, "goal": 1.0, "status": 2}],
        "update": [], "delete": []})


# ---------- login OAuth (aba Ajustes) ----------

_states = set()


def redirect_uri(host):
    return f"http://{host}/oauth/ticktick"


def authorize_url(host):
    cid = config.secret("HANGAR_TICKTICK_CLIENT_ID")
    if not cid or not config.secret("HANGAR_TICKTICK_CLIENT_SECRET"):
        raise SourceError("Preencha o Client ID e o Client Secret do TickTick em Ajustes e salve antes.")
    st = secrets.token_urlsafe(16)
    _states.add(st)
    return OAUTH + "/authorize?" + urllib.parse.urlencode({
        "client_id": cid, "scope": SCOPE, "state": st, "redirect_uri": redirect_uri(host),
        "response_type": "code"})


def finish_login(host, code, state):
    if state not in _states:
        raise SourceError("Login do TickTick expirou ou não começou aqui. Tente de novo pelos Ajustes.")
    _states.discard(state)
    cid, sec = config.secret("HANGAR_TICKTICK_CLIENT_ID"), config.secret("HANGAR_TICKTICK_CLIENT_SECRET")
    form = urllib.parse.urlencode({"code": code, "grant_type": "authorization_code", "scope": SCOPE,
                                   "redirect_uri": redirect_uri(host)}).encode()
    auth = base64.b64encode(f"{cid}:{sec}".encode()).decode()
    r = _http(urllib.request.Request(OAUTH + "/token", data=form, method="POST", headers={
        "Authorization": "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded"}))
    if not r.get("access_token"):
        raise SourceError("O TickTick não devolveu o token.")
    config.save_secrets({"HANGAR_TICKTICK_TOKEN": r["access_token"]})
