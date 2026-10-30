"""Araç fotoğrafındaki camları yarı saydam füme (siyah) cama çevirir.

  python tools/glass.py
Girdi: tools/src/t10x_cut.webp (arka planı silinmiş, camları açık gri)
Çıktı: app/img/t10x.webp
Cam bölgeleri elle çizilmiş çokgenlerdir; içlerinde yalnız renksiz (gri/beyaz)
pikseller koyulaştırılır, böylece kırmızı ayna ve gövde etkilenmez.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "src" / "t10x_cut.webp"
DST = ROOT / "app" / "img" / "t10x.webp"

# 520x271 resim koordinatları
WINDSHIELD = [(126, 69), (140, 52), (160, 33), (182, 21), (205, 14), (240, 11), (300, 11), (344, 13),
              (335, 28), (325, 45), (316, 60), (310, 69)]
SIDE = [(343, 68), (346, 50), (352, 32), (360, 21), (370, 16), (395, 15), (440, 17), (452, 22),
        (464, 36), (472, 50), (476, 62), (476, 69)]

ALPHA = 0.78      # cam opaklığı (0 saydam, 1 tam siyah)
KEEP_LIGHT = 0.22  # yansımalardan korunan parlaklık payı


def main():
    im = Image.open(SRC).convert("RGBA")
    mask = Image.new("L", im.size)
    d = ImageDraw.Draw(mask)
    d.polygon(WINDSHIELD, fill=255)
    d.polygon(SIDE, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1.0))
    px, mk = im.load(), mask.load()
    W, H = im.size
    for y in range(H):
        for x in range(W):
            m = mk[x, y]
            if not m:
                continue
            r, g, b, a = px[x, y]
            sat = max(r, g, b) - min(r, g, b)
            if sat > 45 or a < 10:   # kırmızı gövde/ayna, saydam alan
                continue
            k = m / 255 * min(1.0, (45 - sat) / 20)   # renkli kenarlara yumuşak geçiş
            lum = (r * 0.3 + g * 0.59 + b * 0.11) / 255
            # hafif mavi-füme ton + yansıma izi
            v = lum * KEEP_LIGHT
            nr, ng, nb = (int(255 * min(1, v * t + 0.02)) for t in (0.9, 0.95, 1.08))
            na = int(255 * (ALPHA + (1 - ALPHA) * v))
            px[x, y] = (round(r + (nr - r) * k), round(g + (ng - g) * k), round(b + (nb - b) * k),
                        round(a + (na - a) * k))
    im.save(DST, "WEBP", quality=90, method=6)
    print("yazıldı", DST, im.size)


if __name__ == "__main__":
    main()
