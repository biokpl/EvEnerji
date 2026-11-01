"""Günsan (Tuya tabanlı) akıllı prizleri ev ağından doğrudan okur (tinytuya).

DPS haritası çoğu ölçümlü prizde: 1 anahtar, 18 akım (mA), 19 güç (0,1 W),
20 gerilim (0,1 V). Farklıysa devices_local.json içinde "dps" ve "scale" ile
değiştirilir; probe.py ham değerleri gösterir.
"""
from __future__ import annotations

import logging

import tinytuya

from . import Reading

log = logging.getLogger("tuya")

DEFAULT_DPS = {"switch": "1", "current": "18", "power": "19", "voltage": "20"}
DEFAULT_SCALE = {"current": 0.001, "power": 0.1, "voltage": 0.1}


class TuyaPlug:
    can_switch = True

    def __init__(self, dev_id: str, local: dict):
        self.t = local["tuya"]
        self.dps = {**DEFAULT_DPS, **self.t.get("dps", {})}
        self.scale = {**DEFAULT_SCALE, **self.t.get("scale", {})}
        self.d = self._connect()
        self.fails = 0

    def _connect(self):
        t = self.t
        d = tinytuya.OutletDevice(t["dev_id"], t.get("ip") or "Auto", t["local_key"],
                                  version=float(t.get("version", 3.3)))
        d.set_socketPersistent(True)
        d.set_socketTimeout(4)
        d.set_socketRetryLimit(1)
        return d

    def _num(self, dps: dict, key: str):
        v = dps.get(self.dps[key])
        return None if v is None else float(v) * self.scale[key]

    def read(self) -> Reading:
        try:
            st = self.d.status()
            if not st or "dps" not in st:
                raise RuntimeError(st.get("Error") if isinstance(st, dict) else "yanıt yok")
            dps = st["dps"]
            on = dps.get(self.dps["switch"])
            r = Reading(ok=True, on=None if on is None else bool(on),
                        w=self._num(dps, "power"), v=self._num(dps, "voltage"),
                        a=self._num(dps, "current"))
            if r.on is False:  # kapalı prizde eski güç değeri kalabiliyor
                r.w, r.a = 0.0, 0.0
            self.fails = 0
            return r
        except Exception as e:
            self.fails += 1
            if self.fails % 3 == 0:
                # Ağ kesintisinden sonra v3.4 şifreli oturum bozuk kalabiliyor; yalnız
                # close() yetmedi (saatlerce "Check device key"). Bağlantıyı sıfırdan kur.
                log.warning("%s yeniden bağlanıyor (%d hata): %s", self.t["dev_id"], self.fails, e)
                try:
                    self.d.close()
                except Exception:
                    pass
                self.d = self._connect()
            return Reading(ok=False, err=str(e))

    def set_switch(self, on: bool) -> None:
        res = self.d.turn_on() if on else self.d.turn_off()
        if isinstance(res, dict) and res.get("Error"):
            raise RuntimeError(res["Error"])
