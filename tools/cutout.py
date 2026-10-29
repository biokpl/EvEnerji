"""Araç fotoğrafının açık stüdyo arka planını şeffaf yapar.

  python tools/cutout.py tools/src/t10x.png app/img/t10x.png
Kenarlardan başlayıp açık ve renksiz (gri/beyaz) pikselleri arka plan sayar.
"""
import sys
from collections import deque

from PIL import Image, ImageFilter


def is_bg(p):
    r, g, b = p[:3]
    return max(r, g, b) - min(r, g, b) < 26 and (r + g + b) / 3 > 150


def cutout(src, dst):
    im = Image.open(src).convert("RGBA")
    W, H = im.size
    px = im.load()
    bg = bytearray(W * H)
    q = deque()
    for x in range(W):
        for y in (0, H - 1):
            q.append((x, y))
    for y in range(H):
        for x in (0, W - 1):
            q.append((x, y))
    while q:
        x, y = q.popleft()
        i = y * W + x
        if bg[i] or not is_bg(px[x, y]):
            continue
        bg[i] = 1
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < W and 0 <= ny < H and not bg[ny * W + nx]:
                q.append((nx, ny))
    mask = Image.new("L", (W, H))
    mask.putdata([0 if v else 255 for v in bg])
    # küçük delikleri kapat, kenarı yumuşat
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    im.putalpha(mask)
    box = mask.point(lambda v: 255 if v > 40 else 0).getbbox()
    im = im.crop(box)
    im.save(dst, optimize=True)
    print("yazıldı", dst, im.size)


if __name__ == "__main__":
    cutout(sys.argv[1], sys.argv[2])
