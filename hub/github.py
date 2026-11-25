"""GitHub pelo gh CLI, só leitura: cards atribuídos a mim (com os campos do Project), PRs e o estado dos cards das ideias."""
import json
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor

from . import config
from .store import SourceError

_ISSUES = """query($q:String!){search(query:$q,type:ISSUE,first:60){nodes{... on Issue{
  number title url updatedAt repository{name}
  labels(first:6){nodes{name}}
  projectItems(first:4){nodes{project{number}
    fieldValues(first:16){nodes{
      ... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{name}}}
      ... on ProjectV2ItemFieldIterationValue{title startDate duration field{... on ProjectV2IterationField{name}}}
    }}}}}}}}"""

_PRS = """query($q:String!){search(query:$q,type:ISSUE,first:40){nodes{... on PullRequest{
  number title url isDraft createdAt updatedAt author{login} repository{name}
  reviewDecision
  commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}}"""


def _gql(query, q):
    try:
        out = subprocess.run(["gh", "api", "graphql", "-f", f"q={q}", "-f", f"query={query}"],
                             capture_output=True, text=True, timeout=40)
    except FileNotFoundError as e:
        raise SourceError("O gh não está instalado.") from e
    except subprocess.TimeoutExpired as e:
        raise SourceError("O GitHub demorou demais para responder.") from e
    if out.returncode != 0:
        msg = (out.stderr or "").strip().splitlines()[-1:] or ["erro desconhecido"]
        if "auth" in msg[0].lower() or "401" in msg[0]:
            raise SourceError("O gh está deslogado. Rode `gh auth login`.")
        raise SourceError("O GitHub recusou a leitura: " + msg[0][:200])
    return json.loads(out.stdout)["data"]["search"]["nodes"]


def _card(n, project):
    fields = {}
    for item in n.get("projectItems", {}).get("nodes", []):
        if project and (item.get("project") or {}).get("number") != project:
            continue
        if fields:
            break
        for f in item["fieldValues"]["nodes"]:
            if not f or not f.get("field"):
                continue
            name = f["field"].get("name")
            if "title" in f:  # iteração: vira a sprint, qualquer que seja o nome do campo
                fields["Sprint"] = f["title"]
                fields["SprintStart"] = f.get("startDate")
                fields["SprintDays"] = f.get("duration")
            else:
                fields[name] = f.get("name")
    title = n["title"]
    tag = None
    if "—" in title:
        head, title = title.split("—", 1)
        tag = head.replace("[TASK]", "").replace("[BUG]", "").strip() or None
        title = title.strip()
    return {"number": n["number"], "repo": n["repository"]["name"], "url": n["url"], "tag": tag,
            "title": title, "updatedAt": n["updatedAt"], "status": fields.get("Status"),
            "sprint": fields.get("Sprint"), "sprintStart": fields.get("SprintStart"),
            "sprintDays": fields.get("SprintDays"),
            "priority": fields.get("Priority"), "product": fields.get("Product"),
            "labels": [x["name"] for x in n.get("labels", {}).get("nodes", [])]}


def _pr(n):
    roll = ((n.get("commits") or {}).get("nodes") or [{}])[0]
    checks = (((roll.get("commit") or {}).get("statusCheckRollup")) or {}).get("state")
    return {"number": n["number"], "repo": n["repository"]["name"], "url": n["url"], "title": n["title"],
            "author": (n.get("author") or {}).get("login"), "draft": n.get("isDraft"),
            "createdAt": n["createdAt"], "updatedAt": n["updatedAt"],
            "decision": n.get("reviewDecision"), "checks": checks}


def fetch():
    cfg = config.get()["trabalho"]
    org = cfg["github_org"].strip()
    base = (f"org:{org} " if org else "") + "is:open"
    project = int(cfg["projeto"] or 0)
    with ThreadPoolExecutor(3) as ex:
        cards = ex.submit(_gql, _ISSUES, f"{base} is:issue assignee:@me")
        review = ex.submit(_gql, _PRS, f"{base} is:pr review-requested:@me")
        mine = ex.submit(_gql, _PRS, f"{base} is:pr author:@me")
        return {"cards": [_card(n, project) for n in cards.result() if n],
                "reviews": [_pr(n) for n in review.result() if n],
                "mine": [_pr(n) for n in mine.result() if n]}


# ---------- estado dos cards citados nas ideias (só leitura) ----------
_REF = re.compile(r"(?<![\w/.-])(?:([\w.-]+)/)?([\w.-]+)#(\d+)")
_cards_cache = {"key": None, "at": 0.0, "data": None}
CARDS_TTL = 300


def card_refs(text):
    """Referências `repo#123` ou `dono/repo#123` do campo card; `#123` sozinho fica de fora (não diz o repo)."""
    org = config.get()["trabalho"]["github_org"].strip()
    refs = []
    for owner, repo, num in _REF.findall(text or ""):
        owner = owner or org
        if owner and (owner, repo, int(num)) not in refs:
            refs.append((owner, repo, int(num)))
    return refs


def card_states(refs):
    """{"dono/repo#n": {kind, state, title, url}} em uma consulta só; cache de 5 minutos para o mesmo conjunto."""
    key = tuple(sorted(refs))
    if not key:
        return {}
    c = _cards_cache
    if c["key"] == key and time.time() - c["at"] < CARDS_TTL:
        return c["data"]
    parts = [f'r{k}: repository(owner: {json.dumps(o)}, name: {json.dumps(r)}) {{ issueOrPullRequest(number: {n}) {{'
             " __typename ... on Issue { state stateReason title url } ... on PullRequest { state title url } } }"
             for k, (o, r, n) in enumerate(key)]
    try:
        out = subprocess.run(["gh", "api", "graphql", "-f", "query={ " + " ".join(parts) + " }"],
                             capture_output=True, text=True, timeout=40)
    except FileNotFoundError as e:
        raise SourceError("O gh não está instalado.") from e
    except subprocess.TimeoutExpired as e:
        raise SourceError("O GitHub demorou demais para responder.") from e
    try:
        data = json.loads(out.stdout or "{}").get("data") or {}
    except ValueError:
        data = {}
    if out.returncode != 0 and not data:
        msg = (out.stderr or "").strip().splitlines()[-1:] or ["erro desconhecido"]
        raise SourceError("O GitHub recusou a leitura: " + msg[0][:200])
    res = {}
    for k, (o, r, n) in enumerate(key):
        node = ((data.get(f"r{k}") or {}).get("issueOrPullRequest")) or None
        ref = f"{o}/{r}#{n}"
        if not node:
            res[ref] = {"kind": None, "state": "UNKNOWN", "title": None, "url": None}
            continue
        state = node["state"]
        if state == "CLOSED" and node.get("stateReason") == "NOT_PLANNED":
            state = "NOT_PLANNED"
        res[ref] = {"kind": "pr" if node["__typename"] == "PullRequest" else "issue", "state": state,
                    "title": node.get("title"), "url": node.get("url")}
    c.update(key=key, at=time.time(), data=res)
    return res


def ideias_cards(items):
    """Por ideia com card: as referências com o estado e `done` (todas fechadas ou mergeadas)."""
    per = {i["id"]: card_refs(i.get("card")) for i in items if i.get("card")}
    per = {k: v for k, v in per.items() if v}
    states = card_states([r for refs in per.values() for r in refs])
    out = {}
    for iid, refs in per.items():
        rows = [{"ref": f"{o}/{r}#{n}", "short": f"{r}#{n}", **states.get(f"{o}/{r}#{n}", {"state": "UNKNOWN"})}
                for o, r, n in refs]
        known = [x for x in rows if x["state"] != "UNKNOWN"]
        out[iid] = {"refs": rows, "done": bool(known) and all(x["state"] in ("CLOSED", "MERGED", "NOT_PLANNED") for x in known)}
    return out
