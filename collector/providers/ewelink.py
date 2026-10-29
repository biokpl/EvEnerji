"""eWeLink cihazları (ev şalteri: Tomzn TOBB-63 WiFi).

İki yol:
  lan   — cihaz ağda _ewelink._tcp yayını yapıyorsa (LAN modu) yerel ve anlık okunur.
          Veri AES-128-CBC ile şifreli; anahtar cihazın "devicekey"i (probe.py --ewelink
          bulut hesabından çeker).
  cloud — CoolKit v2 API (dev.ewelink.cc'den alınan app_id/app_secret). 60 sn'de bir.

Ana şalter UZAKTAN KAPATILMAZ: bu sağlayıcı yalnız okur (can_switch = False).
Parametre adları cihaza göre değişebilir; devices_local.json "keys"/"scale" ile ayarlanır.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import threading
import time

import requests

from . import Reading

log = logging.getLogger("ewelink")

DEFAULT_KEYS = {"switch": "switch", "power": "power", "voltage": "voltage", "current": "current"}
DEFAULT_SCALE = {"power": 1.0, "voltage": 1.0, "current": 1.0}


def _parse(params: dict, keys: dict, scale: dict) -> Reading:
    def num(k):
        v = params.get(keys[k])
        try:
            return None if v in (None, "") else float(v) * scale[k]
        except (TypeError, ValueError):
            return None
    sw = params.get(keys["switch"])
    if sw is None and isinstance(params.get("switches"), list) and params["switches"]:
        sw = params["switches"][0].get("switch")
    return Reading(ok=True, on=None if sw is None else sw == "on",
                   w=num("power"), v=num("voltage"), a=num("current"))


# ---------------------------------------------------------------- LAN
class _LanListener:
    """Tek zeroconf dinleyicisi; tüm eWeLink cihazlarının son parametrelerini tutar."""
    _inst = None
    _lock = threading.Lock()

    @classmethod
    def get(cls):
        with cls._lock:
            if cls._inst is None:
                cls._inst = cls()
            return cls._inst

    def __init__(self):
        from zeroconf import ServiceBrowser, Zeroconf
        self.raw: dict[str, tuple[float, dict]] = {}
        self.zc = Zeroconf()
        self.browser = ServiceBrowser(self.zc, "_ewelink._tcp.local.", handlers=[self._on])

    def _on(self, zeroconf, service_type, name, state_change):
        info = zeroconf.get_service_info(service_type, name, 3000)
        if not info:
            return
        props = {k.decode(): (v.decode() if isinstance(v, bytes) else v)
                 for k, v in info.properties.items()}
        did = props.get("id")
        if did:
            self.raw[did] = (time.time(), props)

    @staticmethod
    def decrypt(props: dict, devicekey: str) -> dict:
        data = "".join(props.get(f"data{i}", "") or "" for i in range(1, 5))
        if props.get("encrypt") in (None, "false", False):
            return json.loads(data)
        from Cryptodome.Cipher import AES
        key = hashlib.md5(devicekey.encode()).digest()
        iv = base64.b64decode(props["iv"])
        plain = AES.new(key, AES.MODE_CBC, iv).decrypt(base64.b64decode(data))
        plain = plain[:-plain[-1]]  # PKCS7
        return json.loads(plain.decode())


class EwelinkLan:
    can_switch = False

    def __init__(self, dev_id: str, local: dict):
        e = local["ewelink"]
        self.did, self.key = e["device_id"], e["devicekey"]
        self.keys = {**DEFAULT_KEYS, **e.get("keys", {})}
        self.scale = {**DEFAULT_SCALE, **e.get("scale", {})}
        self.lst = _LanListener.get()

    def read(self) -> Reading:
        item = self.lst.raw.get(self.did)
        if not item:
            return Reading(ok=False, err="LAN yayını yok")
        ts, props = item
        if time.time() - ts > 120:
            return Reading(ok=False, err="LAN verisi eski")
        try:
            return _parse(self.lst.decrypt(props, self.key), self.keys, self.scale)
        except Exception as e:
            return Reading(ok=False, err=f"çözme hatası: {e}")


# ---------------------------------------------------------------- Bulut
class CoolkitCloud:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.base = f"https://{cfg.get('region', 'eu')}-apia.coolkit.cc"
        self.token = None
        self.s = requests.Session()

    def _login(self):
        body = json.dumps({"countryCode": self.cfg.get("country_code", "+90"),
                           "email": self.cfg["email"], "password": self.cfg["password"]})
        sign = base64.b64encode(hmac.new(self.cfg["app_secret"].encode(), body.encode(),
                                         hashlib.sha256).digest()).decode()
        r = self.s.post(f"{self.base}/v2/user/login", data=body, timeout=15, headers={
            "Content-Type": "application/json", "X-CK-Appid": self.cfg["app_id"],
            "Authorization": f"Sign {sign}"}).json()
        if r.get("error"):
            raise RuntimeError(f"eWeLink giriş: {r.get('msg')}")
        self.token = r["data"]["at"]

    def things(self, ids: list[str]) -> dict[str, dict]:
        if not self.token:
            self._login()
        payload = {"thingList": [{"itemType": 1, "id": i} for i in ids]}
        for attempt in range(2):
            r = self.s.post(f"{self.base}/v2/device/thing", json=payload, timeout=15, headers={
                "X-CK-Appid": self.cfg["app_id"], "Authorization": f"Bearer {self.token}"}).json()
            if r.get("error") in (401, 402) and attempt == 0:
                self._login()
                continue
            if r.get("error"):
                raise RuntimeError(f"eWeLink: {r.get('msg')}")
            return {t["itemData"]["deviceid"]: t["itemData"] for t in r["data"]["thingList"]}
        return {}


class EwelinkCloud:
    can_switch = False
    PERIOD = 60

    def __init__(self, dev_id: str, local: dict, api: CoolkitCloud):
        e = local["ewelink"]
        self.did = e["device_id"]
        self.keys = {**DEFAULT_KEYS, **e.get("keys", {})}
        self.scale = {**DEFAULT_SCALE, **e.get("scale", {})}
        self.api = api
        self.last: Reading | None = None
        self.t = 0.0

    def read(self) -> Reading:
        if self.last and time.time() - self.t < self.PERIOD:
            return self.last
        try:
            item = self.api.things([self.did]).get(self.did)
            if not item:
                raise RuntimeError("cihaz bulunamadı")
            self.last = _parse(item.get("params", {}), self.keys, self.scale)
            self.last.ok = bool(item.get("online", True))
        except Exception as e:
            self.last = Reading(ok=False, err=str(e))
        self.t = time.time()
        return self.last


def make_ewelink(dev_id: str, local: dict, cfg: dict, shared: dict):
    mode = local["ewelink"].get("mode", "lan")
    if mode == "lan":
        return EwelinkLan(dev_id, local)
    if "coolkit" not in shared:
        shared["coolkit"] = CoolkitCloud(cfg)
    return EwelinkCloud(dev_id, local, shared["coolkit"])
