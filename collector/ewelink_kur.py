"""Ev şalterini (Tomzn TOBB-63, eWeLink) bir kez bağlar.

  python ewelink_kur.py

1. dev.ewelink.cc'deki uygulamanın App ID / App Secret'ını sorar (config.json'a yazar).
2. eWeLink'in KENDİ giriş sayfasının bağlantısını verir; tarayıcıda giriş yapıp izin
   verirsin, açılan sayfanın adresini kopyalayıp buraya yapıştırırsın (şifre bu
   programa hiç girilmez, Pi'de saklanmaz).
3. Hesaptaki cihazları listeler, şalteri seçer; devicekey'i alıp yerel ağ yayınını
   çözmeyi dener. Başarılıysa LAN modu (anlık, internetsiz); değilse bulut modu.
4. devices_local.json'a "ev_salter" kaydını yazar. Servis yeniden başlayınca
   şalter uygulamada "Ev Şalteri" (ana sayaç) olarak kendiliğinden görünür.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import requests

HERE = Path(__file__).resolve().parent
CFG = HERE / "config.json"
LOCAL = HERE / "devices_local.json"
REDIRECT = "https://127.0.0.1/ewelink"
REGIONS = ("eu", "as", "us", "cn")


def sign(secret: str, msg: str) -> str:
    return base64.b64encode(hmac.new(secret.encode(), msg.encode(), hashlib.sha256).digest()).decode()


def save_json(path: Path, data: dict):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def ask(prompt: str, current: str = "") -> str:
    shown = f" [{current[:4]}…]" if current else ""
    v = input(f"{prompt}{shown}: ").strip()
    return v or current


def main():
    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    ew = cfg.setdefault("ewelink", {})
    print("\n== Ev şalteri kurulumu (eWeLink) ==\n")
    ew["app_id"] = ask("App ID", ew.get("app_id", ""))
    ew["app_secret"] = ask("App Secret", ew.get("app_secret", ""))
    if not ew["app_id"] or not ew["app_secret"]:
        sys.exit("App ID ve App Secret gerekli (dev.ewelink.cc > uygulamam).")
    save_json(CFG, cfg)

    # --- OAuth: eWeLink'in kendi giriş sayfası
    seq = str(int(time.time() * 1000))
    state = secrets.token_hex(4)
    url = "https://c2ccdn.coolkit.cc/oauth/index.html?" + urlencode({
        "clientId": ew["app_id"], "seq": seq, "authorization": sign(ew["app_secret"], f"{ew['app_id']}_{seq}"),
        "redirectUrl": REDIRECT, "grantType": "authorization_code", "state": state,
        "nonce": secrets.token_hex(4), "showQRCode": "false"})
    print("\n1) Bu bağlantıyı tarayıcıda aç, eWeLink hesabınla giriş yap ve izin ver:\n")
    print(url)
    print("\n2) Sonunda 'bu siteye ulaşılamıyor' gibi bir sayfa açılır; bu NORMAL.")
    print("   O sayfanın adres çubuğundaki adresin TAMAMINI kopyalayıp buraya yapıştır.\n")
    back = input("Adres: ").strip()
    q = parse_qs(urlparse(back).query)
    code = (q.get("code") or [""])[0]
    if not code:
        sys.exit("Adreste 'code' bulunamadı. Bağlantıyı yeniden açıp tekrar dene.")
    if (q.get("state") or [state])[0] != state:
        sys.exit("Güvenlik kontrolü (state) tutmadı; tekrar dene.")
    region = (q.get("region") or [ew.get("region", "eu")])[0]

    body = json.dumps({"code": code, "redirectUrl": REDIRECT, "grantType": "authorization_code"})
    tok, tr = None, {}
    for rg in (region,) + tuple(r for r in REGIONS if r != region):
        r = requests.post(f"https://{rg}-apia.coolkit.cc/v2/user/oauth/token", data=body, timeout=15, headers={
            "Content-Type": "application/json", "X-CK-Appid": ew["app_id"],
            "Authorization": f"Sign {sign(ew['app_secret'], body)}"}).json()
        if not r.get("error"):
            tr, tok, region = r["data"], r["data"]["accessToken"], rg
            break
    if not tok:
        sys.exit(f"Jeton alınamadı: {r.get('msg')} (hata {r.get('error')})")
    ew["region"] = region
    save_json(CFG, cfg)

    # --- cihazlar
    r = requests.get(f"https://{region}-apia.coolkit.cc/v2/device/thing", timeout=15, headers={
        "X-CK-Appid": ew["app_id"], "Authorization": f"Bearer {tok}"}).json()
    items = [t["itemData"] for t in r.get("data", {}).get("thingList", []) if t.get("itemData", {}).get("deviceid")]
    if not items:
        sys.exit(f"Hesapta cihaz bulunamadı ({r.get('msg') or r.get('error')}).")
    print("\nHesaptaki cihazlar:")
    for i, it in enumerate(items, 1):
        print(f"  {i}) {it.get('name')}  ({it.get('productModel')}, id {it['deviceid']}, "
              f"{'çevrimiçi' if it.get('online') else 'çevrimdışı'})")
    pick = 1 if len(items) == 1 else int(input("Ev şalteri hangisi? numara: ").strip() or 1)
    dev = items[pick - 1]
    params = dev.get("params", {})
    print("\nŞalterin bildirdiği değerler:")
    for k in ("switch", "power", "voltage", "current", "dayKwh", "oneKwh", "totalKwh"):
        if k in params:
            print(f"  {k} = {params[k]}")

    entry = {"device_id": dev["deviceid"], "devicekey": dev.get("devicekey", ""), "mode": "cloud"}

    # --- LAN denemesi (anlık, internetsiz): yayını devicekey ile çözebiliyor muyuz?
    print("\nYerel ağ yayını deneniyor (20 sn)…")
    try:
        sys.path.insert(0, str(HERE))
        from providers.ewelink import _LanListener
        lst = _LanListener.get()
        for _ in range(20):
            if dev["deviceid"] in lst.raw:
                break
            time.sleep(1)
        if dev["deviceid"] in lst.raw and entry["devicekey"]:
            data = lst.decrypt(lst.raw[dev["deviceid"]][1], entry["devicekey"])
            print("  Çözüldü:", {k: data[k] for k in list(data)[:8]})
            entry["mode"] = "lan"
        else:
            print("  Yerel yayın alınamadı; bulut modu kullanılacak.")
    except Exception as e:
        print(f"  Yerel çözme başarısız ({e}); bulut modu kullanılacak.")

    if entry["mode"] == "cloud":
        # Bulutta okumak için jeton gerekir: yenileme jetonu ile sürdürülür
        ew["oauth"] = {"access_token": tok, "refresh_token": tr.get("refreshToken", ""), "ts": int(time.time())}
        save_json(CFG, cfg)

    local = json.loads(LOCAL.read_text(encoding="utf-8")) if LOCAL.exists() else {}
    local["ev_salter"] = {
        "provider": "ewelink", "ewelink": entry,
        "default_meta": {"name": "Ev Şalteri", "type": "ana_sayac", "provider": "ewelink", "icon": "home",
                         "color": "#9b8cff", "order": 0, "room": "Sigorta kutusu", "max_amp": 63},
    }
    save_json(LOCAL, local)
    print(f"\nTamam: ev_salter kaydı yazıldı ({entry['mode']} modu).")
    print("Şimdi servisi yeniden başlat:  sudo systemctl restart ev-enerji")


if __name__ == "__main__":
    main()
