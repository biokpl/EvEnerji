"""ntfy.sh push bildirimleri.

JSON ile yayınlanır: HTTP başlıkları yalnız Latin-1 taşıdığı için Türkçe karakterli
başlık/düğme metinleri başlıkla gönderilemez (ı, ş, ğ hatası).
"""
from __future__ import annotations

import logging

import requests

log = logging.getLogger("notify")


class Notifier:
    def __init__(self, topic: str, app_url: str = ""):
        self.topic = topic
        self.app_url = app_url

    def payload(self, title: str, msg: str, *, tags: str = "zap", priority: int = 3,
                open_tab: str | None = None) -> dict:
        p = {"topic": self.topic, "title": title, "message": msg,
             "tags": [t for t in tags.split(",") if t], "priority": int(priority)}
        if self.app_url:
            url = self.app_url + (f"#{open_tab}" if open_tab else "")
            p["click"] = url
            p["actions"] = [{"action": "view", "label": "Uygulamayı aç", "url": url}]
        return p

    def send(self, title: str, msg: str, **kw) -> bool:
        if not self.topic:
            return False
        p = self.payload(title, msg, **kw)
        for _ in range(3):
            try:
                requests.post("https://ntfy.sh/", json=p, timeout=10).raise_for_status()
                return True
            except Exception as e:
                log.warning("ntfy hatası: %s", e)
        return False
