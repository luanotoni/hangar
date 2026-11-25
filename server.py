#!/usr/bin/env python3
"""Hangar: hub local (127.0.0.1) que junta TickTick, GitHub, GLPI, um vault de notas e a pauta do dia.

Leituras saem do cache na hora e são atualizadas em segundo plano (hub/store.py).
Escritas só com o cabeçalho X-Hangar e Host/Origin locais.
"""
import html
import json
import sys
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

from hub import claude, config, foco, paths, ticktick, vault
from hub.sources import ALL, TICKTICK, enabled
from hub.store import SourceError

PORT = paths.port()
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}


def _session_path(day):
    date.fromisoformat(day)  # valida, evita path traversal
    return paths.SESSIONS / f"{day}.json"


def _tt_write(fn):
    def run(body):
        fn(body)
        TICKTICK.refresh_now()
    return run


def _save_session(body):
    f = _session_path(body["date"])
    paths.SESSIONS.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(body, ensure_ascii=False))
    tmp.replace(f)


def _save_config(body):
    if isinstance(body.get("config"), dict):
        config.save(body["config"])
    if isinstance(body.get("secrets"), dict):
        config.save_secrets(body["secrets"])
    for s in ALL.values():
        s.invalidate()


def _vault_state():
    return {"pendencias": vault.pendencias(), "ideias": vault.ideias(), "pauta": vault.pauta(),
            "jobs": claude.jobs}


POSTS = {
    "/api/task/complete": _tt_write(ticktick.complete_task),
    "/api/task/postpone": _tt_write(ticktick.postpone_task),
    "/api/task/update": _tt_write(ticktick.update_task),
    "/api/task/date": _tt_write(ticktick.date_task),
    "/api/habit/checkin": _tt_write(ticktick.checkin_habit),
    "/api/session": _save_session,
    "/api/pendencia/add": vault.pend_add,
    "/api/pendencia/toggle": vault.pend_toggle,
    "/api/ideia/add": vault.ideia_add,
    "/api/ideia/move": vault.ideia_move,
    "/api/ideia/edit": vault.ideia_edit,
    "/api/ideia/obs": vault.ideia_obs,
    "/api/ideia/archive": vault.ideia_archive,
    "/api/ideia/delete": vault.ideia_delete,
    "/api/pauta/toggle": vault.pauta_toggle,
    "/api/foco/registrar": foco.registrar,
    "/api/foco/editar": foco.editar,
    "/api/foco/apagar": foco.apagar,
    "/api/pauta/gerar": lambda b: claude.start("pauta", claude.gerar_pauta),
    "/api/config": _save_config,
    "/api/ideias/gerar": lambda b: claude.start("ideias", claude.gerar_ideias, b.get("foco")),
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(paths.WEB), **kw)

    def log_message(self, fmt, *args):
        msg = fmt % args
        if "code 4" in msg or "code 5" in msg or "POST" in msg:
            sys.stderr.write(msg + "\n")

    def end_headers(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/") or path in ("/", "/index.html"):
            self.send_header("Cache-Control", "no-store")
        elif "/fonts/" in path:
            self.send_header("Cache-Control", "max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def _guard(self, write=False):
        if self.headers.get("Host") not in ALLOWED_HOSTS:
            self.send_error(403, "host")
            return False
        if write:
            origin = self.headers.get("Origin")
            if origin and origin.split("//", 1)[-1] not in ALLOWED_HOSTS:
                self.send_error(403, "origin")
                return False
            if self.headers.get("X-Hangar") != "1" or "application/json" not in self.headers.get("Content-Type", ""):
                self.send_error(403, "header")
                return False
        return True

    def _json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _redirect(self, url):
        self.send_response(302)
        self.send_header("Location", url)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _page(self, code, msg):
        b = (f'<!doctype html><meta charset="utf-8"><title>Hangar</title><p>{html.escape(msg)}</p>'
             '<p><a href="/#ajustes">Voltar aos Ajustes</a></p>').encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 200_000:
            raise ValueError("corpo grande demais")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        if not self._guard():
            return
        path, _, query = self.path.partition("?")
        q = {k: v[0] for k, v in parse_qs(query).items()}
        if path.startswith("/api/src/"):
            src = enabled().get(path.rsplit("/", 1)[-1])
            if not src:
                self._json(404, {"error": "fonte desconhecida"})
                return
            self._json(200, src.get(force=q.get("force") == "1"))
            return
        if path == "/oauth/ticktick/start":
            try:
                self._redirect(ticktick.authorize_url(self.headers["Host"]))
            except SourceError as e:
                self._page(400, str(e))
            return
        if path == "/oauth/ticktick":
            try:
                if q.get("error"):
                    raise SourceError("O TickTick negou o acesso: " + q["error"])
                ticktick.finish_login(self.headers["Host"], q.get("code", ""), q.get("state", ""))
                TICKTICK.invalidate()
                self._redirect("/#ajustes")
            except SourceError as e:
                self._page(400, str(e))
            return
        if path == "/api/config":
            self._json(200, config.public())
            return
        if path == "/api/vault":
            try:
                self._json(200, _vault_state())
            except OSError as e:
                self._json(502, {"error": f"Não consegui ler o vault: {e}"})
            return
        if path == "/api/foco":
            try:
                self._json(200, foco.stats())
            except OSError as e:
                self._json(502, {"error": f"Não consegui ler as notas de foco: {e}"})
            return
        if path == "/api/session":
            try:
                f = _session_path(q.get("date", ""))
            except ValueError:
                self._json(400, {"error": "data inválida"})
                return
            self._json(200, json.loads(f.read_text()) if f.exists() else {})
            return
        if path.startswith("/api/"):
            self._json(404, {"error": "rota desconhecida"})
            return
        super().do_GET()

    def do_POST(self):
        if not self._guard(write=True):
            return
        fn = POSTS.get(self.path)
        if not fn:
            self._json(404, {"error": "rota desconhecida"})
            return
        try:
            r = fn(self._body())
            self._json(200, {"ok": True, "result": r if isinstance(r, (int, bool, str)) else None})
        except SourceError as e:
            self._json(502, {"error": str(e)})
        except (ValueError, KeyError, TypeError) as e:
            self._json(400, {"error": f"pedido inválido: {e}"})
        except (OSError, RuntimeError) as e:
            self._json(500, {"error": str(e)[:300]})


def main():
    paths.DATA.mkdir(parents=True, exist_ok=True)
    for s in enabled().values():  # aquece o cache para a primeira abertura
        s.refresh_async()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Hangar em http://127.0.0.1:{PORT}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
