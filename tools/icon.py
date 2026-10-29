"""Uygulama ikonlarını app/img/t10x.webp (arka planı silinmiş araç fotoğrafı) ile üretir.

  python tools/icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "icons"
CAR = ROOT / "app" / "img" / "t10x.webp"
SS = 2


def vgrad(size, top, bottom):
    g = Image.new("RGBA", (1, size[1]))
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
    return g.resize(size)


def make(size, path, pad=0.0, rounded=True):
    S = size * SS
    inner = 1 - 2 * pad
    bg = vgrad((S, S), (16, 26, 46), (5, 9, 18))
    # kırmızı/turkuaz parıltı
    glow = Image.new("L", (S, S), 0)
    ImageDraw.Draw(glow).ellipse([S * .05, S * .45, S * .95, S * 1.0], fill=120)
    bg.paste((212, 21, 42, 255), (0, 0), glow.filter(ImageFilter.GaussianBlur(S * .1)))
    # araç
    car = Image.open(CAR).convert("RGBA")
    w = int(S * inner * .96)
    h = int(car.height * w / car.width)
    car = car.resize((w, h), Image.LANCZOS)
    x = int(S * pad + (S * inner - w) / 2)
    y = int(S * pad + S * inner * .60 - h / 2)
    # zemin gölgesi
    sh = Image.new("L", (S, S), 0)
    ImageDraw.Draw(sh).ellipse([x + w * .06, y + h * .86, x + w * .96, y + h * 1.04], fill=170)
    bg.paste((0, 0, 0, 255), (0, 0), sh.filter(ImageFilter.GaussianBlur(S * .02)))
    bg.paste(car, (x, y), car)
    # şimşek rozeti
    d = ImageDraw.Draw(bg)
    bx, by, br = S * (pad + inner * .82), S * (pad + inner * .18), S * inner * .105
    d.ellipse([bx - br, by - br, bx + br, by + br], fill=(34, 211, 214, 255))
    bolt = [(.54, .2), (.32, .56), (.48, .56), (.42, .82), (.68, .42), (.52, .42), (.6, .2)]
    d.polygon([(bx - br + px * 2 * br, by - br + py * 2 * br) for px, py in bolt], fill=(6, 11, 20, 255))
    if rounded:
        m = Image.new("L", (S, S), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * .22), fill=255)
        out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        out.paste(bg, (0, 0), m)
        bg = out
    bg.resize((size, size), Image.LANCZOS).save(path)


if __name__ == "__main__":
    make(192, OUT / "icon-192.png")
    make(512, OUT / "icon-512.png")
    make(512, OUT / "icon-maskable-512.png", pad=0.1, rounded=False)
    print("ikonlar yazıldı:", OUT)
