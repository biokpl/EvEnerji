"""Firebase Realtime Database REST yardımcıları.

Pi, veritabanı gizli anahtarıyla (firebase_secret) yazar; bu anahtar kuralları
aşar. Telefon anahtarsız olduğu için yalnız kuralların izin verdiği yerlere yazabilir.
"""
from __future__ import annotations

import json
import logging

import requests

log = logging.getLogger("fb")


class FB:
    def __init__(self, url: str, base: str = "", secret: str = ""):
        base = (base or "").strip("/")
        self.root = url.rstrip("/") + (f"/{base}" if base else "")
        self.auth = {"auth": secret} if secret else {}
        self.s = requests.Session()

    def _u(self, path: str) -> str:
        path = (path or "").strip("/")
        return f"{self.root}/{path}.json" if path else f"{self.root}/.json"

    def get(self, path: str, **params):
        q = {k: json.dumps(v) if k in ("orderBy", "startAt", "endAt", "equalTo") else v
             for k, v in params.items()}
        r = self.s.get(self._u(path), params={**q, **self.auth}, timeout=15)
        r.raise_for_status()
        return r.json()

    def put(self, path: str, data) -> None:
        self.s.put(self._u(path), params=self.auth, data=json.dumps(data), timeout=15).raise_for_status()

    def patch(self, path: str, data: dict) -> None:
        self.s.patch(self._u(path), params=self.auth, data=json.dumps(data), timeout=15).raise_for_status()

    def delete(self, path: str) -> None:
        self.s.delete(self._u(path), params=self.auth, timeout=15).raise_for_status()

    def safe(self, fn, *a, **kw):
        try:
            return fn(*a, **kw)
        except Exception as e:  # ağ kesintisi servisi durdurmasın
            log.warning("Firebase hatası: %s", e)
            return None
