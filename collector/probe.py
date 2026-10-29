"""Keşif aracı: cihazın ham verisini görüp DPS / parametre adlarını doğrulamak için.

  python probe.py tuya <id>          devices_local.json'daki prizi 5 kez okur (ham DPS)
  python probe.py ewelink-lan        ağdaki eWeLink LAN yayınlarını 20 sn dinler
  python probe.py ewelink-cloud      bulut hesabındaki cihazları, devicekey ve parametreleriyle yazar
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    mode = sys.argv[1]
    cfg = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
    local = json.loads((HERE / "devices_local.json").read_text(encoding="utf-8")) \
        if (HERE / "devices_local.json").exists() else {}

    if mode == "tuya":
        import tinytuya
        t = local[sys.argv[2]]["tuya"]
        d = tinytuya.OutletDevice(t["dev_id"], t.get("ip") or "Auto", t["local_key"],
                                  version=float(t.get("version", 3.3)))
        for _ in range(5):
            print(d.status())
            time.sleep(2)

    elif mode == "ewelink-lan":
        from providers.ewelink import _LanListener
        lst = _LanListener.get()
        time.sleep(20)
        if not lst.raw:
            print("LAN yayını bulunamadı: şalter LAN modunu desteklemiyor olabilir -> bulut modu.")
        for did, (ts, props) in lst.raw.items():
            print(did, json.dumps(props, ensure_ascii=False))
            key = next((v["ewelink"].get("devicekey") for v in local.values()
                        if v.get("ewelink", {}).get("device_id") == did), None)
            if key:
                print("  çözülmüş:", lst.decrypt(props, key))

    elif mode == "ewelink-cloud":
        from providers.ewelink import CoolkitCloud
        api = CoolkitCloud(cfg["ewelink"])
        api._login()
        r = api.s.get(f"{api.base}/v2/device/thing", timeout=15, headers={
            "X-CK-Appid": cfg["ewelink"]["app_id"], "Authorization": f"Bearer {api.token}"}).json()
        for t in r.get("data", {}).get("thingList", []):
            it = t.get("itemData", {})
            print(f"\n{it.get('name')}  id={it.get('deviceid')}  devicekey={it.get('devicekey')}"
                  f"  model={it.get('productModel')}  online={it.get('online')}")
            print(json.dumps(it.get("params", {}), ensure_ascii=False, indent=1))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
