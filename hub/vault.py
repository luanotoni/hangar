"""Notas do vault que o hub lê e escreve: pendências soltas, ideias e a pauta do dia.

Formato pensado para continuar legível e editável no Obsidian. Toda escrita relê o arquivo,
muda só o trecho certo e grava de forma atômica.
"""
import hashlib
import re
import threading
from datetime import date, datetime

import glob

from . import config, paths
from .store import SourceError

_lock = threading.Lock()
STAGES = ["Ideia", "Explorando", "Proposta", "Virou card", "Descartada"]


def _write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text)
    tmp.replace(path)


def _hid(*parts):
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:10]


def _ddmm(d=None):
    return (d or date.today()).strftime("%d/%m")


# ---------- pendências soltas ----------

def _tags():
    return [a["id"] for a in config.get()["areas"] if a.get("id")]


def _pend_head():
    tags = ", ".join(f"`#{t}`" for t in _tags())
    return f"""---
tipo: conhecimento
status: ativo
tags: [pendencias]
---

# Pendências soltas

Coisas pequenas que não viram card: avisar alguém, conferir algo, lembrar de um detalhe.
O hub Hangar lê e escreve aqui; editar à mão também vale (uma linha por item, {tags} para a área).

"""
_PEND = re.compile(r"^- \[( |x)\] (.+)$")


def _pend_lines():
    try:
        return paths.pendencias().read_text().splitlines()
    except FileNotFoundError:
        return _pend_head().splitlines()


def pendencias():
    out = []
    for i, line in enumerate(_pend_lines()):
        m = _PEND.match(line)
        if not m:
            continue
        text = m.group(2)
        tags = [t for t in re.findall(r"#([\wÀ-ú-]+)", text)]
        since = re.search(r"\(desde (\d{2}/\d{2})\)", text)
        doneat = re.search(r"\(feito (\d{2}/\d{2})\)", text)
        clean = re.sub(r"\s*\((desde|feito) \d{2}/\d{2}\)", "", text)
        clean = re.sub(r"\s*#[\wÀ-ú-]+", "", clean).strip()
        out.append({"id": _hid(str(i), text), "line": i, "done": m.group(1) == "x", "text": clean,
                    "tags": tags, "since": since and since.group(1), "doneAt": doneat and doneat.group(1)})
    return out


def pend_add(body):
    text = " ".join(str(body.get("text", "")).split())[:300]
    if not text:
        raise ValueError("texto vazio")
    tag = body.get("tag")
    if tag in _tags() and f"#{tag}" not in text:
        text += f" #{tag}"
    with _lock:
        lines = _pend_lines()
        while lines and not lines[-1].strip():
            lines.pop()
        lines.append(f"- [ ] {text} (desde {_ddmm()})")
        _write(paths.pendencias(), "\n".join(lines) + "\n")


def pend_toggle(body):
    with _lock:
        lines = _pend_lines()
        for item in pendencias():
            if item["id"] != body.get("id"):
                continue
            line = lines[item["line"]]
            if item["done"]:
                line = re.sub(r"\s*\(feito \d{2}/\d{2}\)", "", line.replace("- [x] ", "- [ ] ", 1))
            else:
                line = line.replace("- [ ] ", "- [x] ", 1) + f" (feito {_ddmm()})"
            lines[item["line"]] = line
            _write(paths.pendencias(), "\n".join(lines) + "\n")
            return
    raise ValueError("essa pendência mudou no arquivo; recarregue")


# ---------- ideias e melhorias ----------

IDEIAS_HEAD = """---
tipo: conhecimento
status: ativo
tags: [ideias, melhorias]
---

# Ideias e melhorias

Caminhos para melhorar e inovar no trabalho.
O hub Hangar organiza por estágio; cada ideia é um `###` dentro do estágio. Mover no hub só troca a seção.

"""


def _ideias_text():
    try:
        return paths.ideias().read_text()
    except FileNotFoundError:
        return IDEIAS_HEAD + "".join(f"## {s}\n\n" for s in STAGES)


def _parse_ideias(text):
    """Devolve (cabeçalho, {estágio: [blocos]}) onde bloco = {'title', 'body'}."""
    head, sections, cur, block = [], {s: [] for s in STAGES}, None, None
    for line in text.splitlines():
        if line.startswith("## "):
            cur, block = line[3:].strip(), None
            sections.setdefault(cur, [])
            continue
        if line.startswith("### ") and cur is not None:
            block = {"title": line[4:].strip(), "body": []}
            sections[cur].append(block)
            continue
        if block is not None:
            block["body"].append(line)
        elif cur is None:
            head.append(line)
    return "\n".join(head).rstrip() + "\n\n", sections


def _render_ideias(head, sections):
    out = [head]
    for stage, blocks in sections.items():
        out.append(f"## {stage}\n\n")
        for b in blocks:
            body = "\n".join(b["body"]).strip("\n")
            out.append(f"### {b['title']}\n{body}\n\n" if body else f"### {b['title']}\n\n")
    return "".join(out).rstrip() + "\n"


# Corpo de uma ideia, na ordem em que o hub escreve (e qualquer ordem que alguém deixar à mão):
#   - **área**: …  (metadados, uma linha cada)
#   **Problema:** … / **Proposta:** … / **Primeiro passo:** …  (um parágrafo cada)
#   texto livre (explorações, decisões…)
#   #### Observações  seguido de "- dd/mm: texto", uma por linha
# Editar mexe só no trecho que mudou; o resto do bloco fica como está.
META_KEYS = ("área", "impacto", "esforço", "origem", "card", "arquivada")
_META = re.compile(r"^- \*\*(" + "|".join(META_KEYS) + r")\*\*: (.+)$")
FIELDS = (("problem", "Problema"), ("proposal", "Proposta"), ("firstStep", "Primeiro passo"))
_FIELD = re.compile(r"^\*\*(" + "|".join(lbl for _, lbl in FIELDS) + r"):\*\*\s*(.*)$")
OBS_HEAD = "#### Observações"
_OBS = re.compile(r"^- (\d{2}/\d{2}(?:/\d{2,4})?):\s*(.*)$")
EDIT_META = (("area", "área"), ("impact", "impacto"), ("effort", "esforço"), ("card", "card"))
STALE = "essa ideia mudou no arquivo; recarregue"


def _segments(lines):
    """Quebra o corpo em trechos: meta (1 linha), field (parágrafo), obs (seção), rest e blank."""
    segs, i, n = [], 0, len(lines)
    while i < n:
        s = lines[i].strip()
        if not s:
            segs.append({"kind": "blank", "lines": [lines[i]]})
            i += 1
        elif (m := _META.match(s)):
            segs.append({"kind": "meta", "key": m.group(1), "value": m.group(2).strip(), "lines": [lines[i]]})
            i += 1
        elif (m := _FIELD.match(s)):
            j = i + 1
            while j < n and lines[j].strip():
                j += 1
            key = next(k for k, lbl in FIELDS if lbl == m.group(1))
            segs.append({"kind": "field", "key": key, "lines": lines[i:j]})
            i = j
        elif s.lower() == OBS_HEAD.lower():
            j, last = i + 1, i
            while j < n:
                t = lines[j]
                if _OBS.match(t.strip()) or (t[:1].isspace() and t.strip() and last == j - 1):
                    last = j
                elif t.strip():
                    break
                j += 1
            segs.append({"kind": "obs", "lines": lines[i:last + 1]})
            i = last + 1
        else:
            if segs and segs[-1]["kind"] == "rest":
                segs[-1]["lines"].append(lines[i])
            else:
                segs.append({"kind": "rest", "lines": [lines[i]]})
            i += 1
    return segs


def _flat(segs):
    out = []
    for s in segs:
        for line in s["lines"]:
            if not line.strip() and (not out or not out[-1].strip()):
                continue  # uma linha em branco basta
            out.append(line)
    while out and not out[-1].strip():
        out.pop()
    return out


def _rest_text(segs):
    lines = [ln for s in segs if s["kind"] in ("rest", "blank") for ln in s["lines"]]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def _field_text(seg):
    first = _FIELD.match(seg["lines"][0].strip()).group(2)
    return "\n".join([first, *(ln.strip() for ln in seg["lines"][1:])]).strip()


def _obs_list(seg):
    out = []
    for line in seg["lines"][1:]:
        if (m := _OBS.match(line.strip())):
            out.append({"date": m.group(1), "text": m.group(2).strip()})
        elif line.strip() and out:
            out[-1]["text"] += " " + line.strip()
    return out


def _rev(block):
    return _hid(block["title"], "\n".join(block["body"]).strip("\n"))


def _one_line(v, limit):
    return " ".join(str(v or "").split())[:limit]


def _nl(v):
    return str(v or "").replace("\r\n", "\n").replace("\r", "\n")


def ideias():
    _, sections = _parse_ideias(_ideias_text())
    out = []
    for stage, blocks in sections.items():
        for b in blocks:
            segs = _segments(b["body"])
            meta = {s["key"]: s["value"] for s in segs if s["kind"] == "meta"}
            fields = {s["key"]: _field_text(s) for s in segs if s["kind"] == "field"}
            obs = [o for s in segs if s["kind"] == "obs" for o in _obs_list(s)]
            out.append({"id": _hid(b["title"]), "rev": _rev(b), "stage": stage, "title": b["title"],
                        "text": _rest_text(segs), "obs": obs,
                        "area": meta.get("área"), "impact": meta.get("impacto"), "effort": meta.get("esforço"),
                        "origin": meta.get("origem"), "card": meta.get("card"), "archived": meta.get("arquivada"),
                        **{k: fields.get(k) for k, _ in FIELDS}})
    return {"stages": list(sections.keys()), "items": out}


def _idea_block(it, origin):
    lines = []
    for key, label in (("area", "área"), ("impact", "impacto"), ("effort", "esforço")):
        if it.get(key):
            lines.append(f"- **{label}**: {it[key]}")
    lines.append(f"- **origem**: {origin}")
    lines.append("")
    for key, label in FIELDS:
        if it.get(key):
            lines.append(f"**{label}:** {' '.join(str(it[key]).split())}")
            lines.append("")
    if it.get("text"):
        lines.append(str(it["text"]).strip())
    return {"title": " ".join(str(it["title"]).split())[:140], "body": lines}


def ideias_add(items, origin):
    with _lock:
        head, sections = _parse_ideias(_ideias_text())
        taken = {b["title"].lower() for bs in sections.values() for b in bs}
        added = 0
        for it in items:
            if not it.get("title") or it["title"].strip().lower() in taken:
                continue
            sections.setdefault("Ideia", []).append(_idea_block(it, origin))
            taken.add(it["title"].strip().lower())
            added += 1
        _write(paths.ideias(), _render_ideias(head, sections))
        return added


def ideia_add(body):
    if not str(body.get("title", "")).strip():
        raise ValueError("título vazio")
    return ideias_add([body], f"{config.get()['usuario']['nome'] or 'eu'}, {_ddmm()}")


def _change(body, fn, check_rev=False):
    """Acha a ideia pelo id (e pela revisão, quando pedida), aplica fn(sections, stage, block) e grava."""
    with _lock:
        head, sections = _parse_ideias(_ideias_text())
        for stage, blocks in sections.items():
            for b in blocks:
                if _hid(b["title"]) != body.get("id"):
                    continue
                if check_rev and body.get("rev") != _rev(b):
                    raise ValueError(STALE)
                before = _render_ideias(head, sections)
                result = fn(sections, stage, b)
                after = _render_ideias(head, sections)
                if after != before:
                    _write(paths.ideias(), after)
                return result
    raise ValueError(STALE)


def ideia_move(body):
    to = body.get("stage")

    def move(sections, stage, b):
        if to not in sections:
            raise ValueError("estágio desconhecido")
        if to != stage:
            sections[stage].remove(b)
            sections[to].append(b)
    _change(body, move)


def _set_meta(segs, key, value):
    """Troca, cria (depois do último metadado) ou tira a linha `- **key**: value`."""
    line = f"- **{key}**: {value}"
    cur = next((s for s in segs if s["kind"] == "meta" and s["key"] == key), None)
    if cur and value:
        cur["lines"], cur["value"] = [line], value
    elif cur:
        segs.remove(cur)
    elif value:
        metas = [i for i, s in enumerate(segs) if s["kind"] == "meta"]
        new = {"kind": "meta", "key": key, "value": value, "lines": [line]}
        if metas:  # na ordem de META_KEYS: depois do último que vem antes dele
            prev = [i for i in metas if META_KEYS.index(segs[i]["key"]) < META_KEYS.index(key)]
            segs.insert(prev[-1] + 1 if prev else metas[0], new)
        else:  # sem metadados: a lista vai no topo, com uma linha em branco antes do texto
            segs[0:0] = [new, {"kind": "blank", "lines": [""]}]


def _set_field(segs, key, label, text):
    lines = [ln.strip() for ln in str(text or "").splitlines() if ln.strip()]
    cur = next((s for s in segs if s["kind"] == "field" and s["key"] == key), None)
    if not lines:
        if cur:
            segs.remove(cur)
        return
    new = [f"**{label}:** {lines[0]}", *lines[1:]]
    if cur:
        cur["lines"] = new
        return
    order = [k for k, _ in FIELDS]
    after = [i for i, s in enumerate(segs) if (s["kind"] == "field" and order.index(s["key"]) < order.index(key)) or s["kind"] == "meta"]
    before = [i for i, s in enumerate(segs) if s["kind"] == "field" and order.index(s["key"]) > order.index(key)]
    at = before[0] if before else (after[-1] + 1 if after else 0)
    segs[at:at] = [{"kind": "blank", "lines": [""]}, {"kind": "field", "key": key, "lines": new}, {"kind": "blank", "lines": [""]}]


def _set_rest(segs, text):
    text = str(text or "").strip("\n")
    idx = [i for i, s in enumerate(segs) if s["kind"] == "rest"]
    at = idx[0] if idx else next((i for i, s in enumerate(segs) if s["kind"] == "obs"), len(segs))
    for i in reversed(idx):
        del segs[i]
    if text.strip():
        segs[at:at] = [{"kind": "blank", "lines": [""]}, {"kind": "rest", "lines": text.splitlines()}, {"kind": "blank", "lines": [""]}]


def ideia_edit(body):
    """Edita título, metadados, Problema/Proposta/Primeiro passo e o texto livre. Só as chaves enviadas mudam."""
    title = _one_line(body["title"], 140) if "title" in body else None
    if title is not None and not title:
        raise ValueError("título vazio")

    def edit(sections, stage, b):
        if title and title != b["title"]:
            if any(o is not b and o["title"].lower() == title.lower() for bs in sections.values() for o in bs):
                raise ValueError("já existe uma ideia com esse título")
            b["title"] = title
        segs = _segments(b["body"])
        meta = {s["key"]: s["value"] for s in segs if s["kind"] == "meta"}
        for k, label in EDIT_META:
            if k in body and _one_line(body[k], 200) != (meta.get(label) or ""):
                _set_meta(segs, label, _one_line(body[k], 200))
        fields = {s["key"]: _field_text(s) for s in segs if s["kind"] == "field"}
        for k, label in FIELDS:
            if k in body and _nl(body[k]).strip() != (fields.get(k) or ""):
                _set_field(segs, k, label, _nl(body[k]))
        if "text" in body and _nl(body["text"]).strip() != _rest_text(segs):
            _set_rest(segs, _nl(body["text"]))
        b["body"] = _flat(segs) if segs != _segments(b["body"]) else b["body"]
        return _hid(b["title"])
    return _change(body, edit, check_rev=True)


def ideia_obs(body):
    """Acrescenta `- dd/mm: texto` na seção Observações da ideia (cria a seção no fim do bloco)."""
    text = _one_line(body.get("text"), 2000)
    if not text:
        raise ValueError("observação vazia")

    def add(sections, stage, b):
        segs = _segments(b["body"])
        item = f"- {_ddmm()}: {text}"
        obs = next((s for s in segs if s["kind"] == "obs"), None)
        if obs:
            obs["lines"].append(item)
        else:
            segs += [{"kind": "blank", "lines": [""]}, {"kind": "obs", "lines": [OBS_HEAD, item]}]
        b["body"] = _flat(segs)
    _change(body, add)


def ideia_archive(body):
    """Arquiva (some do quadro, fica na nota com `- **arquivada**: dd/mm`) ou desarquiva."""
    def arch(sections, stage, b):
        segs = _segments(b["body"])
        _set_meta(segs, "arquivada", _ddmm() if body.get("on", True) else "")
        b["body"] = _flat(segs)
    _change(body, arch)


def ideia_delete(body):
    """Tira da nota uma ideia descartada, de vez."""
    def delete(sections, stage, b):
        if stage != STAGES[-1]:
            raise ValueError(f"só dá para excluir ideias em {STAGES[-1]}")
        sections[stage].remove(b)
    _change(body, delete, check_rev=True)


# ---------- pauta do dia ----------

def pauta_path(d=None):
    return paths.conversas() / f"{(d or date.today()).isoformat()} - Pauta do dia.md"


def _strip_front(text):
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end > 0:
            return text[end + 4:].lstrip("\n")
    return text


def pauta():
    """A pauta de hoje (gerada pelo Claude) e, se houver, outras notas de pauta escritas hoje."""
    today = date.today().isoformat()
    out = {"date": today, "auto": None, "extra": []}
    f = pauta_path()
    if f.exists():
        st = f.stat()
        out["auto"] = {"name": f.stem, "markdown": _strip_front(f.read_text()),
                       "at": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="minutes")}
    for g in sorted(paths.conversas().glob(f"{today} - *auta*.md")):
        if g != f:
            out["extra"].append({"name": g.stem, "markdown": _strip_front(g.read_text())})
    if not out["auto"]:
        prev = sorted(paths.conversas().glob("*- Pauta do dia.md"))
        if prev:
            out["last"] = prev[-1].stem
    return out


def pauta_toggle(body):
    """Marca/desmarca um `- [ ]` da pauta de hoje pelo índice do checkbox."""
    f = pauta_path()
    with _lock:
        if not f.exists():
            raise ValueError("ainda não há pauta hoje")
        lines, n = f.read_text().splitlines(), -1
        for i, line in enumerate(lines):
            m = re.match(r"^(\s*- )\[( |x)\] ", line)
            if not m:
                continue
            n += 1
            if n == int(body.get("index", -1)):
                mark = " " if m.group(2) == "x" else "x"
                lines[i] = f"{m.group(1)}[{mark}] " + line[m.end():]
                _write(f, "\n".join(lines) + "\n")
                return
    raise ValueError("item da pauta não encontrado")


def save_pauta(markdown, model):
    f = pauta_path()
    today = date.today()
    front = (f"---\ntipo: conversa\ndata: {today.isoformat()}\ntags: [conversa, pauta, automatica]\n"
             f"gerada: {datetime.now().isoformat(timespec='minutes')} pelo hub Hangar ({model})\n---\n\n")
    title = f"# Pauta do dia ({_ddmm(today)})\n\n"
    body = markdown.strip()
    if body.startswith("# "):
        body = body.split("\n", 1)[1].lstrip() if "\n" in body else ""
    with _lock:
        new = not f.exists()
        _write(f, front + title + body + "\n")
        reg_path = paths.registro()
        if new and reg_path and reg_path.exists():
            reg = reg_path.read_text().rstrip("\n")
            line = f"- [[{f.stem}]] — gerada automaticamente pelo hub Hangar"
            if line not in reg:
                _write(reg_path, reg + "\n" + line + "\n")
    return f


def extra_notes(key="notas_contexto"):
    """Notas extras da configuração (globs; relativos ao vault), só o texto."""
    out, seen = [], set()
    for pattern in config.get()["claude"][key]:
        p = config.path(pattern)
        if not p.is_absolute():
            p = paths.vault() / p
        for name in sorted(glob.glob(str(p))):
            if name in seen:
                continue
            seen.add(name)
            name = paths.Path(name)
            try:
                out.append((name.stem, _strip_front(name.read_text())[:3500]))
            except OSError:
                continue
    return out


def read_note(path, limit=4000):
    try:
        return _strip_front(path.read_text())[:limit]
    except OSError:
        return ""


def require_vault():
    if not paths.vault().exists():
        raise SourceError(f"O vault não está em {paths.vault()}.")
