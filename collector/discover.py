"""Tuya bulutundan prizleri ve local key'leri çeker, ev ağında IP'lerini bulur.

Elle:  python discover.py          (bulunanları listeler ve devices_local.json'a yazar)
Servis içinden: sync() 6 saatte bir çağrılır; yeni prizler uygulamada
"Yeni cihaz bulundu" olarak görünür.
"""
from __future__ import annotations

import json
import logging
import re
import sys
from pathlib import Path

import tinytuya

log = logging.getLogger("discover")
HERE = Path(__file__).resolve().parent

SOCKET_CATEGORIES = {"cz", "pc", "kg", "tdq", "dlq"}  # priz, uzatma, anahtar, şalter


def slug(name: str, did: str) -> str:
    tr = str.maketrans("çğıöşüÇĞİÖŞÜ ", "cgiosuCGIOSU_")
    s = re.sub(r"[^a-z0-9_]", "", name.translate(tr).lower())
    return s or did[-6:]


def sync(tc: dict, local_file: Path, known_ids: set[str]) -> dict:
    cloud = tinytuya.Cloud(apiRegion=tc.get("api_region", "eu"), apiKey=tc["api_key"],
                           apiSecret=tc["api_secret"], apiDeviceID=tc.get("any_device_id") or None)
    devs = cloud.getdevices(verbose=False)
    if isinstance(devs, dict) and devs.get("Error"):
        raise RuntimeError(devs)
    scan = tinytuya.deviceScan(verbose=False, maxretry=8) or {}
    ips = {v.get("gwId") or v.get("id"): v for v in scan.values()}

    local = json.loads(local_file.read_text(encoding="utf-8")) if local_file.exists() else {}
    by_tuya = {v["tuya"]["dev_id"]: k for k, v in local.items() if v.get("provider") == "tuya"}
    new = {}
    for d in devs:
        tid = d["id"]
        net = ips.get(tid, {})
        # Sürüm yalnız tarama prizi gördüyse yazılır. Görmediyse varsayılanla EZİLMEZ: kısa taramada
        # yayın yapmayan priz 3.3 sanılıp sonraki açılışta okunamıyordu ("Unexpected Payload").
        entry = {"dev_id": tid, "local_key": d["key"], "ip": net.get("ip", ""),
                 "version": float(net["version"]) if net.get("version") else None}
        if tid in by_tuya:  # anahtar/IP değişmiş olabilir
            local[by_tuya[tid]]["tuya"].update({k: v for k, v in entry.items() if v})
            continue
        entry["version"] = entry["version"] or 3.4   # yeni priz, tarama görmediyse: güncel prizler 3.4
        if d.get("category") not in SOCKET_CATEGORIES:
            continue
        did = slug(d.get("name", ""), tid)
        while did in local:
            did += "_2"
        local[did] = {"provider": "tuya", "tuya": entry}
        if did not in known_ids:
            new[did] = {"name": d.get("name") or "Yeni priz", "product": d.get("product_name", ""),
                        "category": d.get("category"), "ip": entry["ip"], "provider": "tuya"}
    local_file.write_text(json.dumps(local, ensure_ascii=False, indent=2), encoding="utf-8")
    return new


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    cfg = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
    if not cfg.get("tuya_cloud", {}).get("api_key"):
        sys.exit("config.json > tuya_cloud doldurulmamış (KURULUM.md adım 2).")
    found = sync(cfg["tuya_cloud"], HERE / "devices_local.json", set())
    print(json.dumps(found, ensure_ascii=False, indent=2))
    print(f"{len(found)} priz devices_local.json'a yazıldı.")
