"""Enerji biriktirme ve şarj oturumu algılama (saf mantık, test edilebilir).

Enerji = güç x süre (iki ölçüm arasında yamuk kuralı). Kısa kopukluklarda
(<10 dk) güç sürekli varsayılır; daha uzunsa yalnız bir ölçüm aralığı sayılır.
"""
from __future__ import annotations

from datetime import datetime

GAP_MAX_S = 600

# Şarj oturumu eşikleri (Mennekes 10 A ≈ 2,2 kW)
SESSION_START_W = 300
SESSION_START_N = 2          # art arda kaç ölçüm
SESSION_END_W = 50
SESSION_END_S = 300          # bu kadar süre düşük güç -> bitti
SESSION_MIN_KWH = 0.05       # bundan küçükse oturum sayılmaz


def day_key(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")


class DeviceMeter:
    def __init__(self, dev_id: str, state: dict, poll_s: float):
        self.id = dev_id
        self.st = state.setdefault(dev_id, {"last_ts": None, "last_w": None,
                                            "hours": {}, "days": {}})
        self.poll_s = poll_s

    def add(self, ts: float, w: float | None) -> float:
        """Ölçüm ekler, bu aralıkta biriken kWh'yi döndürür."""
        st = self.st
        added = 0.0
        if w is not None and st["last_ts"] is not None and st["last_w"] is not None:
            dt = ts - st["last_ts"]
            if 0 < dt:
                if dt > GAP_MAX_S:
                    dt = self.poll_s
                added = (st["last_w"] + w) / 2.0 * dt / 3_600_000.0
                self._book(ts, added)
        if w is not None:
            st["last_ts"], st["last_w"] = ts, w
        return added

    def _book(self, ts: float, kwh: float) -> None:
        d = datetime.fromtimestamp(ts)
        dk = d.strftime("%Y-%m-%d")
        hours = self.st["hours"].setdefault(dk, [0.0] * 24)
        hours[d.hour] += kwh
        self.st["days"][dk] = self.st["days"].get(dk, 0.0) + kwh
        # yalnız bugün ve dün saatlik tutulur
        for k in sorted(self.st["hours"])[:-2]:
            del self.st["hours"][k]

    def month_total(self, ym: str) -> float:
        return sum(v for k, v in self.st["days"].items() if k.startswith(ym))


class SessionTracker:
    """Araç şarj oturumlarını güç eğrisinden ayırır."""

    def __init__(self, state: dict):
        self.st = state.setdefault("session", {"active": None, "hi_n": 0, "hi_first": None,
                                               "low_since": None})

    @property
    def active(self) -> dict | None:
        return self.st["active"]

    def update(self, ts: float, w: float | None, kwh_added: float) -> tuple[str | None, dict | None]:
        """('basladi'|'bitti'|None, oturum) döndürür."""
        st = self.st
        if w is None:
            if st["active"]:
                st["active"]["kwh"] += kwh_added
            return None, st["active"]
        a = st["active"]
        if a is None:
            if w >= SESSION_START_W:
                st["hi_n"] += 1
                st["hi_first"] = st["hi_first"] or ts
                if st["hi_n"] >= SESSION_START_N:
                    start = st["hi_first"]
                    st["active"] = {
                        "id": datetime.fromtimestamp(start).strftime("%Y%m%d-%H%M"),
                        "start": int(start), "end": None, "kwh": kwh_added,
                        "peak_w": w, "last_w": w, "active": True}
                    st["hi_n"], st["hi_first"], st["low_since"] = 0, None, None
                    return "basladi", st["active"]
            else:
                st["hi_n"], st["hi_first"] = 0, None
            return None, None
        a["kwh"] += kwh_added
        a["peak_w"] = max(a["peak_w"], w)
        a["last_w"] = w
        if w < SESSION_END_W:
            st["low_since"] = st["low_since"] or ts
            if ts - st["low_since"] >= SESSION_END_S:
                a["end"] = int(st["low_since"])
                a["active"] = False
                st["active"], st["low_since"] = None, None
                if a["kwh"] < SESSION_MIN_KWH:
                    return None, None
                return "bitti", a
        else:
            st["low_since"] = None
        return None, a


def merge_months(bills: dict | None, meter: dict | None) -> list[float]:
    """Yılın 12 ayı: fatura (elle girilen) ile sayaç ölçümünden büyük olanı.
    Sayaç ay ortasında başladıysa o ayın faturası eksik kısmı tamamlar."""
    bills, meter = bills or {}, meter or {}
    out = []
    for m in range(1, 13):
        k = f"{m:02d}"
        out.append(max(float(bills.get(k) or 0), float(meter.get(k) or 0)))
    return out
