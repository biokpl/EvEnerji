"""Uygulama içi bildirim (Web Push, VAPID).

Telefon aboneliği uygulamadan settings/push/{kimlik} altına yazılır; Pi her bildirimde bu abonelikleri okur ve
şifreli olarak gönderir (ntfy ya da başka bir aracı uygulama yok). Süresi dolan abonelik (404/410) silinir.
Gizli anahtar yalnız Pi'de: ~/evenerji/vapid_private.pem
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

log = logging.getLogger("notify")

VAPID_KEY = Path(__file__).resolve().parent.parent / "vapid_private.pem"
VAPID_SUB = "https://biokpl.github.io"

# ntfy etiket adları (eski çağrılar) → başlığın önüne konan simge
SIMGE = {"electric_plug": "🔌", "white_check_mark": "✅", "warning": "⚠️", "zap": "⚡", "house": "🏠",
         "calendar": "📅", "cloud_with_lightning_and_rain": "⛈️", "dash": "💨", "memo": "📝",
         "chart_with_upwards_trend": "📈", "chart_with_downwards_trend": "📉", "rotating_light": "🚨",
         "printer": "🖨️", "bell": "🔔", "battery": "🔋"}


class Notifier:
    def __init__(self, fb, app_url: str = "", key_path: Path | str = VAPID_KEY):
        self.fb = fb
        self.app_url = app_url
        self.key_path = str(key_path)

    def payload(self, title: str, msg: str, *, tags: str = "zap", priority: int = 3,
                open_tab: str | None = None, buton: str = "Uygulamayı aç", etiket: str | None = None) -> dict:
        simge = next((SIMGE[t] for t in tags.split(",") if t in SIMGE), "")
        return {"title": f"{simge} {title}".strip(), "body": msg, "url": (self.app_url or "./") + (f"#{open_tab}" if open_tab else ""),
                "buton": buton, "tag": etiket or f"ev-{int(time.time() * 1000)}", "oncelik": int(priority),
                "ts": int(time.time() * 1000)}

    def abonelikler(self) -> dict:
        return self.fb.safe(self.fb.get, "settings/push") or {}

    def send(self, title: str, msg: str, **kw) -> bool:
        if not Path(self.key_path).exists():
            log.warning("Bildirim anahtarı yok: %s", self.key_path)
            return False
        subs = self.abonelikler()
        if not subs:
            log.info("Bildirim aboneliği yok: %s", title)
            return False
        from pywebpush import WebPushException, webpush
        p = self.payload(title, msg, **kw)
        oncelik = p["oncelik"]
        basliklar = {"Urgency": "high" if oncelik >= 4 else "normal" if oncelik >= 3 else "low"}
        gonderildi = False
        for kim, s in subs.items():
            if not isinstance(s, dict) or not s.get("endpoint"):
                continue
            try:
                webpush(subscription_info={"endpoint": s["endpoint"], "keys": s.get("keys") or {}},
                        data=json.dumps(p, ensure_ascii=False), vapid_private_key=self.key_path,
                        vapid_claims={"sub": VAPID_SUB}, ttl=6 * 3600, headers=basliklar, timeout=10)
                gonderildi = True
            except WebPushException as e:
                kod = getattr(getattr(e, "response", None), "status_code", None)
                if kod in (404, 410):
                    log.info("Süresi dolan abonelik silindi: %s", kim)
                    self.fb.safe(self.fb.delete, f"settings/push/{kim}")
                else:
                    log.warning("Bildirim gönderilemedi (%s): %s", kod, e)
            except Exception as e:  # ağ kesintisi servisi durdurmasın
                log.warning("Bildirim hatası: %s", e)
        return gonderildi
