"""Araç fotoğrafındaki camları yarı saydam füme (siyah) cama çevirir.

  python tools/glass.py [yansima: yok|capraz|gok|cift] [çıktı]
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

ALPHA = 0.64      # cam opaklığı (0 saydam, 1 tam siyah)
KEEP_LIGHT = 0.30  # yansımalardan korunan parlaklık payı
REFLECT = "gok"   # cama eklenen yansıma deseni (bkz. reflect())


def band(t, center, width):
    """Yumuşak kenarlı şerit: merkezde 1, kenarlara doğru 0."""
    d = abs(t - center) / width
    return max(0.0, 1 - d * d)


def reflect(kind, x, y):
    """Cam üzerine eklenecek beyaz parlama miktarı (0..1)."""
    t = x + y * 1.7   # sağ üstten sol alta eğik çizgiler
    if kind == "capraz":    # tek geniş çapraz parlama
        return 0.30 * band(t, 250, 34) + 0.30 * band(t, 430, 26)
    if kind == "cift":      # iki ince paralel şerit
        return 0.42 * band(t, 236, 11) + 0.26 * band(t, 262, 7) + 0.38 * band(t, 418, 9) + 0.22 * band(t, 440, 6)
    if kind == "gok":       # üstten gökyüzü yansıması + hafif şerit
        return 0.34 * max(0.0, 1 - y / 46) ** 1.6 + 0.18 * band(t, 250, 22)
    return 0.0


def main(kind=REFLECT, dst=DST):
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
            r2, g2, b2, a2 = (r + (nr - r) * k, g + (ng - g) * k, b + (nb - b) * k, a + (na - a) * k)
            f = reflect(kind, x, y) * k
            if f:
                r2, g2, b2 = (c + (w - c) * f for c, w in ((r2, 225), (g2, 236), (b2, 250)))
                a2 += (255 - a2) * f
            px[x, y] = (round(r2), round(g2), round(b2), round(a2))
    im.save(dst, "WEBP", quality=90, method=6)
    print("yazıldı", dst, im.size)


if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else REFLECT, Path(sys.argv[2]) if len(sys.argv) > 2 else DST)
