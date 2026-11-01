"""Günsan (Tuya tabanlı) akıllı prizleri ev ağından doğrudan okur (tinytuya).

DPS haritası çoğu ölçümlü prizde: 1 anahtar, 18 akım (mA), 19 güç (0,1 W),
20 gerilim (0,1 V). Farklıysa devices_local.json içinde "dps" ve "scale" ile
değiştirilir; probe.py ham değerleri gösterir.
"""
from __future__ import annotations

import logging
import time

import tinytuya

from . import Reading

log = logging.getLogger("tuya")

DEFAULT_DPS = {"switch": "1", "current": "18", "power": "19", "voltage": "20"}
DEFAULT_SCALE = {"current": 0.001, "power": 0.1, "voltage": 0.1}
BACKOFF_S = 15      # 6+ art arda hatada prizi bu aralıkla dene
VERSIONS = (3.4, 3.5, 3.3)   # Tuya yerel protokol sürümleri


class TuyaPlug:
    can_switch = True

    def __init__(self, dev_id: str, local: dict):
        self.t = local["tuya"]
        self.dps = {**DEFAULT_DPS, **self.t.get("dps", {})}
        self.scale = {**DEFAULT_SCALE, **self.t.get("scale", {})}
        # Önce kayıtlı sürüm; bozuk yanıt sürerse diğerleri denenir (yanlış kayıtlı sürüme karşı)
        first = float(self.t.get("version") or 3.4)
        self.versions = [first] + [v for v in VERSIONS if v != first]
        self.vi = 0
        self.d = self._connect()
        self.fails = 0
        self.skip_until = 0.0
        self.last_err = ""
        self.proto_bad_since: float | None = None   # time.monotonic()

    def _connect(self):
        t = self.t
        d = tinytuya.OutletDevice(t["dev_id"], t.get("ip") or "Auto", t["local_key"],
                                  version=self.versions[self.vi])
        # Kalıcı soket kullanılmaz: Smart Life telefondan yerel bağlanınca ya da priz
        # kendiliğinden veri itince kalıcı oturum bozuluyor ("Unexpected Payload").
        # Her okumada kısa bir bağlantı açıp kapatmak daha sağlam.
        d.set_socketPersistent(False)
        d.set_socketTimeout(4)
        d.set_socketRetryLimit(1)
        return d

    def _num(self, dps: dict, key: str):
        v = dps.get(self.dps[key])
        return None if v is None else float(v) * self.scale[key]

    def read(self) -> Reading:
        now = time.monotonic()
        if now < self.skip_until:           # art arda hata: prize toparlanması için ara ver
            return Reading(ok=False, err=self.last_err)
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
            if self.fails and self.versions[self.vi] != self.versions[0]:
                log.warning("%s sürüm %s ile okundu (kayıtlı %s)", self.t["dev_id"], self.versions[self.vi], self.versions[0])
            self.fails, self.proto_bad_since = 0, None
            return r
        except Exception as e:
            self.fails += 1
            self.last_err = str(e)
            # Her hatada bağlantıyı kesin kapat: yarım kalan bağlantılar birikince priz
            # (az sayıda eşzamanlı bağlantı kabul ediyor) bozuk yanıt vermeye başlıyor.
            try:
                self.d.close()
            except Exception:
                pass
            if self.fails % 3 == 0:
                if not str(e).startswith("Network Error"):   # priz ağda ama anlaşamıyoruz: sürümü değiştir
                    self.vi = (self.vi + 1) % len(self.versions)
                log.warning("%s yeniden bağlanıyor (%d hata, sürüm %s): %s", self.t["dev_id"], self.fails,
                            self.versions[self.vi], e)
                self.d = self._connect()
            if self.fails >= 6:
                self.skip_until = now + BACKOFF_S
            # Ağda olduğu halde bozuk yanıt (protokol hatası) ne zamandır sürüyor?
            # "Network Error" = priz kapalı/ulaşılamıyor; o durumda servis yeniden başlatılmaz.
            if str(e).startswith("Network Error"):
                self.proto_bad_since = None
            elif self.proto_bad_since is None:
                self.proto_bad_since = now
            return Reading(ok=False, err=str(e))

    def set_switch(self, on: bool) -> None:
        res = self.d.turn_on() if on else self.d.turn_off()
        if isinstance(res, dict) and res.get("Error"):
            raise RuntimeError(res["Error"])
