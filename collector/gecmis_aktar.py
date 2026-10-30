"""Tuya prizinin, Pi ölçmeye başlamadan önceki tüketimini içeri aktarır (bir kez).

  sudo systemctl stop ev-enerji
  python gecmis_aktar.py <cihaz_id> <pi_baslangic>     ör. camasir_ve_kurutma 2026-10-30T20:38:47
  sudo systemctl start ev-enerji

Tuya bulutu prizin enerji artış kayıtlarını (add_ele) yalnız SON 7 GÜN tutar; yeni bir
priz eklenince bu araç hemen çalıştırılırsa o 7 gün kaybolmaz.
- Kayıtlar <pi_baslangic> öncesiyle sınırlanır (Pi'nin ölçtüğüyle üst üste binmez).
- Gün/saat toplamları Pi'nin hafızasına (state.json) ve Firebase'e (days/hours/months) eklenir;
  ay toplamını Pi hafızadaki günlerden hesapladığı için ikisine de yazılması gerekir.
- Aynı cihaz için ikinci kez çalışmaz (state.json > imported).
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import tinytuya

from fb import FB

HERE = Path(__file__).resolve().parent
CFG = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
STATE_FILE = HERE / "state.json"


def fetch_logs(cloud, tuya_id: str, end_ms: int) -> list[dict]:
    """Son 7 günün add_ele kayıtları (sayfalı), end_ms öncesi."""
    start_ms = end_ms - 7 * 86400 * 1000
    out, row, seen = [], None, set()
    for _ in range(100):
        q = {"codes": "add_ele", "start_time": str(start_ms), "end_time": str(end_ms), "size": "100"}
        if row:
            q["last_row_key"] = row
        r = cloud.cloudrequest(f"/v2.0/cloud/thing/{tuya_id}/report-logs", query=q)
        if not r.get("success"):
            sys.exit(f"Tuya kayıtları okunamadı: {r.get('code')} {r.get('msg')}")
        res = r.get("result") or {}
        for x in res.get("logs") or []:
            k = (x["event_time"], x["value"])
            if k not in seen and int(x["event_time"]) < end_ms:
                seen.add(k)
                out.append(x)
        row = res.get("last_row_key")
        if not res.get("has_more") or not row:
            break
        time.sleep(0.3)
    return out


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    did, start_iso = sys.argv[1], sys.argv[2]
    pi_start = datetime.fromisoformat(start_iso)
    if subprocess.run(["systemctl", "is-active", "--quiet", "ev-enerji"]).returncode == 0:
        sys.exit("Önce servisi durdur: sudo systemctl stop ev-enerji")

    local = json.loads((HERE / "devices_local.json").read_text(encoding="utf-8"))
    if local.get(did, {}).get("provider") != "tuya":
        sys.exit(f"{did}: devices_local.json'da Tuya prizi değil")
    tuya_id = local[did]["tuya"]["dev_id"]
    state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    imp = state.setdefault("imported", {})
    if did in imp:
        sys.exit(f"{did} daha önce aktarılmış ({imp[did]}).")
    meter = state.get("meters", {}).get(did)
    if meter is None:
        sys.exit(f"{did}: Pi henüz bu cihazı ölçmemiş (state.json'da yok)")

    tc = CFG["tuya_cloud"]
    cloud = tinytuya.Cloud(apiRegion=tc.get("api_region", "eu"), apiKey=tc["api_key"],
                           apiSecret=tc["api_secret"], apiDeviceID=tc.get("any_device_id") or None)
    spec = cloud.cloudrequest(f"/v1.0/devices/{tuya_id}/specifications")
    scale = 3   # add_ele: 0,001 kWh (Tuya "values" alanı JSON metni olarak gelir)
    for st in (spec.get("result") or {}).get("status", []):
        if st.get("code") == "add_ele":
            v = st.get("values")
            scale = int((json.loads(v) if isinstance(v, str) else v or {}).get("scale", 3))
    logs = fetch_logs(cloud, tuya_id, int(pi_start.timestamp() * 1000))
    if not logs:
        sys.exit("Aktarılacak kayıt yok.")

    days: dict[str, float] = {}
    hours: dict[str, list[float]] = {}
    for x in logs:
        t = datetime.fromtimestamp(int(x["event_time"]) / 1000)
        kwh = int(x["value"]) / 10 ** int(scale)
        dk = t.strftime("%Y-%m-%d")
        days[dk] = days.get(dk, 0.0) + kwh
        hours.setdefault(dk, [0.0] * 24)[t.hour] += kwh

    fb = FB(CFG["firebase_url"], CFG.get("base_path", ""), CFG.get("firebase_secret", ""))
    upd = {}
    for dk in sorted(days):
        meter["days"][dk] = meter["days"].get(dk, 0.0) + days[dk]
        upd[f"days/{did}/{dk}"] = round(meter["days"][dk], 4)
        if dk in meter.get("hours", {}):          # Pi'nin hafızasında olan gün: oraya ekle
            meter["hours"][dk] = [a + b for a, b in zip(meter["hours"][dk], hours[dk])]
            arr = meter["hours"][dk]
        else:                                      # eski gün: buluttakiyle birleştir
            old = fb.get(f"hours/{did}/{dk}") or [0.0] * 24
            arr = [float(a or 0) + b for a, b in zip(old, hours[dk])]
        upd[f"hours/{did}/{dk}"] = [round(v, 4) for v in arr]
    for ym in sorted({dk[:7] for dk in days}):
        upd[f"months/{did}/{ym}"] = round(sum(v for k, v in meter["days"].items() if k.startswith(ym)), 3)

    imp[did] = {"until": start_iso, "kwh": round(sum(days.values()), 3), "at": datetime.now().isoformat(timespec="seconds")}
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    tmp.replace(STATE_FILE)
    fb.patch("", upd)
    for dk in sorted(days):
        print(f"  {dk}: +{days[dk]:.3f} kWh")
    print(f"Toplam {sum(days.values()):.3f} kWh aktarıldı ({len(logs)} kayıt, {min(days)} → {max(days)}).")


if __name__ == "__main__":
    main()
