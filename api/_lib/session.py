"""Confere a sessão emitida por server/auth.mjs (mesmo SESSAO_SEGREDO), sem reimplementar
a lógica de login: só valida o token HMAC que o Node já assinou."""
import base64
import hashlib
import hmac
import json
import os
import time


def _b64url_decode(value):
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def read_session(headers, cookie_name="sala_sessao"):
    secret = os.environ.get("SESSAO_SEGREDO", "").encode("utf-8")
    if not secret:
        return None
    token = None
    auth = headers.get("authorization") or headers.get("Authorization") or ""
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    if not token:
        cookie = headers.get("cookie") or headers.get("Cookie") or ""
        for part in cookie.split(";"):
            part = part.strip()
            if part.startswith(cookie_name + "="):
                token = part[len(cookie_name) + 1:]
                break
    if not token or "." not in token:
        return None
    payload_b64, signature_b64 = token.split(".", 1)
    try:
        received = _b64url_decode(signature_b64)
        data = json.loads(_b64url_decode(payload_b64))
    except Exception:
        return None
    expected = hmac.new(secret, payload_b64.encode("utf-8"), hashlib.sha256).digest()
    if not hmac.compare_digest(expected, received):
        return None
    if not isinstance(data.get("e"), str) or data.get("x", 0) <= time.time() * 1000:
        return None
    if data.get("t"):
        return None  # bilhete de SSE; não vale como sessão
    return {"email": data["e"], "nome": data.get("n", "")}
