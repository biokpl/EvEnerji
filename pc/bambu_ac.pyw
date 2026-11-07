"""Bambu Studio öne gelince (açılış dahil) 3D yazıcının prizini açar. Yalnız AÇAR, asla kapatmaz.

Pi'deki ev ağı kapısını çağırır: http://<pi>:8099/ac/<cihaz>?k=<anahtar>  (ayarlar bambu_ac.json'da, repoda değil).
Windows açılışında Görev Zamanlayıcı ile pythonw üzerinden pencere açmadan çalışır.
"""
import ctypes
import ctypes.wintypes as wt
import json
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CFG = json.loads((HERE / "bambu_ac.json").read_text(encoding="utf-8"))
LOG = HERE / "bambu_ac.log"
HEDEF = CFG.get("exe", "bambu-studio.exe").lower()

user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32


def log(msg: str):
    try:
        satirlar = LOG.read_text(encoding="utf-8").splitlines()[-200:] if LOG.exists() else []
        satirlar.append(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}")
        LOG.write_text("\n".join(satirlar) + "\n", encoding="utf-8")
    except OSError:
        pass


def on_plandaki_exe() -> str:
    """Öndeki pencerenin program adı (küçük harf)."""
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return ""
    pid = wt.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    h = kernel32.OpenProcess(0x1000, False, pid.value)          # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(512)
        n = wt.DWORD(512)
        if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)):
            return Path(buf.value).name.lower()
    finally:
        kernel32.CloseHandle(h)
    return ""


def priz_ac():
    for deneme in range(3):
        try:
            with urllib.request.urlopen(CFG["url"], timeout=10) as r:
                log(f"açma isteği: {r.read().decode('utf-8', 'replace')}")
                return
        except Exception as e:                       # Pi kapalı / ağ yok: birkaç kez dene
            hata = e
            time.sleep(5)
    log(f"açılamadı: {hata}")


def main():
    log("başladı")
    ondeydi = False
    son = 0.0
    while True:
        onde = on_plandaki_exe() == HEDEF
        # Bambu Studio'ya her geçişte (en sık 2 dk'da bir) aç; arka planda dururken hiçbir şey yapma
        if onde and not ondeydi and time.time() - son > 120:
            son = time.time()
            priz_ac()
        ondeydi = onde
        time.sleep(2)


if __name__ == "__main__":
    main()
