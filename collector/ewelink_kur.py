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


def ask(prompt: str, current: str = "", secret: bool = False) -> str:
    if current:   # kayıtlıysa sorma; değiştirmek için config.json'dan silinir
        print(f"{prompt}: kayıtlı")
        return current
    if secret:
        import getpass
        return getpass.getpass(f"{prompt} (yazdığın görünmez): ").strip()
    return input(f"{prompt}: ").strip()


def api_host(region: str) -> str:
    return "cn-apia.coolkit.cn" if region == "cn" else f"{region}-apia.coolkit.cc"


def oauth_link(ew: dict, state: str) -> str:
    seq = str(int(time.time() * 1000))
    return "https://c2ccdn.coolkit.cc/oauth/index.html?" + urlencode({
        "clientId": ew["app_id"], "seq": seq, "authorization": sign(ew["app_secret"], f"{ew['app_id']}_{seq}"),
        "redirectUrl": REDIRECT, "grantType": "authorization_code", "state": state,
        "nonce": secrets.token_hex(4), "showQRCode": "false"})


def get_token(ew: dict, code: str, region: str):
    """Kodu jetona çevirir. Önce eWeLink'in bildirdiği bölge; olmazsa diğerleri. (veri, bölge, hata)"""
    body = json.dumps({"code": code, "redirectUrl": REDIRECT, "grantType": "authorization_code"})
    last = ""
    for rg in (region,) + tuple(r for r in REGIONS if r != region):
        try:
            r = requests.post(f"https://{api_host(rg)}/v2/user/oauth/token", data=body, timeout=15, headers={
                "Content-Type": "application/json", "X-CK-Appid": ew["app_id"], "X-CK-Nonce": secrets.token_hex(4),
                "Authorization": f"Sign {sign(ew['app_secret'], body)}"}).json()
        except requests.RequestException as e:
            last = f"{rg}: bağlantı hatası ({e.__class__.__name__})"
            continue
        if not r.get("error"):
            return r["data"], rg, ""
        last = f"{rg}: {r.get('msg')} (hata {r.get('error')})"
        if r.get("error") == 405:   # kod geçersiz/süresi dolmuş: başka bölge denemek boşuna
            break
    return None, region, last


def main():
    cfg = json.loads(CFG.read_text(encoding="utf-8"))
    ew = cfg.setdefault("ewelink", {})
    print()
    print("== Ev şalteri kurulumu (eWeLink) ==")
    print()
    ew["app_id"] = ask("App ID", ew.get("app_id", ""))
    ew["app_secret"] = ask("App Secret", ew.get("app_secret", ""), secret=True)
    if not ew["app_id"] or not ew["app_secret"]:
        sys.exit("App ID ve App Secret gerekli (dev.ewelink.cc > uygulamam).")
    save_json(CFG, cfg)

    # --- OAuth: eWeLink'in kendi giriş sayfası (kod 30 sn geçerli; olmazsa yeni bağlantı verilir)
    tr = None
    for deneme in range(1, 4):
        state = secrets.token_hex(4)
        print()
        print(f"1) Bu bağlantıyı tarayıcıda aç, eWeLink hesabınla giriş yap ve izin ver (deneme {deneme}/3):")
        print()
        print(oauth_link(ew, state))
        print()
        print("2) Sonunda 'bu siteye ulaşılamıyor' gibi bir sayfa açılır; bu NORMAL.")
        print("   O sayfanın adres çubuğundaki adresin TAMAMINI kopyalayıp HEMEN (30 sn içinde) buraya yapıştır.")
        print()
        back = input("Adres: ").strip()
        q = parse_qs(urlparse(back).query)
        code = (q.get("code") or [""])[0]
        if not code:
            print("!! Adreste 'code' yok. Yeni bağlantıyla tekrar deneyelim.")
            continue
        if (q.get("state") or [state])[0] != state:
            print("!! Bu adres eski bir bağlantıya ait. Yeni bağlantıyla tekrar deneyelim.")
            continue
        tr, region, err = get_token(ew, code, (q.get("region") or [ew.get("region", "eu")])[0])
        if tr:
            break
        print(f"!! Jeton alınamadı: {err}")
        print("   Kodun süresi dolmuş olabilir (30 sn). Yeni bağlantıyla tekrar deneyelim.")
    if not tr:
        sys.exit("3 denemede jeton alınamadı.")
    tok = tr["accessToken"]
    print()
    print(f"Giriş tamam (bölge: {region}).")
    ew["region"] = region
    save_json(CFG, cfg)

    # --- cihazlar
    r = requests.get(f"https://{api_host(region)}/v2/device/thing", timeout=15, headers={
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
            if dev["deviceid"] in lst.ip:   # yayın gelmezse kullanılacak yedek adres
                entry["ip"] = lst.ip[dev["deviceid"]][0]
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
