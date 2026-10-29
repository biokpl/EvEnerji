"""ntfy.sh push bildirimleri (GridTracker notifier.py ile aynı yöntem)."""
from __future__ import annotations

import logging

import requests

log = logging.getLogger("notify")


class Notifier:
    def __init__(self, topic: str, app_url: str = ""):
        self.topic = topic
        self.app_url = app_url

    def send(self, title: str, msg: str, *, tags: str = "zap", priority: int = 3,
             open_tab: str | None = None) -> None:
        if not self.topic:
            return
        headers = {"Title": title.encode("utf-8"), "Tags": tags, "Priority": str(priority)}
        if self.app_url:
            url = self.app_url + (f"#{open_tab}" if open_tab else "")
            headers["Click"] = url
            headers["Actions"] = f"view, Uygulamayı aç, {url}"
        for _ in range(3):
            try:
                requests.post(f"https://ntfy.sh/{self.topic}", data=msg.encode("utf-8"),
                              headers=headers, timeout=10).raise_for_status()
                return
            except Exception as e:
                log.warning("ntfy hatası: %s", e)
