"""Cihaz sağlayıcıları. Her sağlayıcı read() -> Reading döndürür.

Yeni bir marka eklemek için: aynı arayüzle (read, set_switch, can_switch) yeni
bir modül yazıp make_provider'a eklemek yeterli; uygulama tarafı değişmez.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Reading:
    ok: bool
    on: bool | None = None
    w: float | None = None
    v: float | None = None
    a: float | None = None
    err: str | None = None


def make_provider(dev_id: str, local: dict, cfg: dict, shared: dict):
    kind = local.get("provider")
    if kind == "tuya":
        from .tuya_local import TuyaPlug
        return TuyaPlug(dev_id, local)
    if kind == "ewelink":
        from .ewelink import make_ewelink
        return make_ewelink(dev_id, local, cfg.get("ewelink", {}), shared)
    raise ValueError(f"Bilinmeyen sağlayıcı: {kind}")
