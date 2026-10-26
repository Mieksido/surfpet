#!/usr/bin/env python3
"""Generate the procedural mouth overlays used by the layered rig.

The skins' base art only ships with one mouth expression.  These overlays let
the rig animate between "closed" and "open" without redrawing the whole face:

  skins/feiyu-01/art/11_mouth_open.png         standalone open mouth, top edge
                                               cut straight (w line hidden by
                                               mouth.hideBase)
  skins/feiyu-03/art/10_mouth_open.png         open-mouth hole (transparent bg)
  skins/feiyu-03/art/10_mouth_open_cover.png   same muzzle patch, w line erased
  skins/feiyu-05/art/12_mouth_open.png         small open-mouth hole
  skins/feiyu-05/art/12_mouth_open_cover.png   same patch, dot erased

Skins 02 / 04 already have an open mouth in the art; the rig closes them by
squashing the mouth layer vertically, so they need no extra file.  Skin 01
hides its closed w mouth while the mouth opens, so this overlay is the whole
mouth and does not need a second lip line.

Requires Pillow + numpy (only needed when regenerating the art):

    python tools/mouth-art.py
"""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'skins'


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

def load(skin: str, name: str) -> Image.Image:
    return Image.open(ART / skin / 'art' / name).convert('RGBA')


def save(skin: str, name: str, img: Image.Image) -> None:
    out = ART / skin / 'art' / name
    img.save(out)
    print('wrote', out.relative_to(ROOT))


def blank(canvas: int) -> Image.Image:
    return Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))


def vertical_gradient(w: int, h: int, top: tuple[int, int, int],
                      bottom: tuple[int, int, int]) -> Image.Image:
    a = np.zeros((h, w, 4), dtype=np.uint8)
    for y in range(h):
        t = y / max(1, h - 1)
        a[y, :, 0] = int(top[0] + (bottom[0] - top[0]) * t)
        a[y, :, 1] = int(top[1] + (bottom[1] - top[1]) * t)
        a[y, :, 2] = int(top[2] + (bottom[2] - top[2]) * t)
        a[y, :, 3] = 255
    return Image.fromarray(a, 'RGBA')


# ---------------------------------------------------------------------------
# feiyu-01: open the w mouth downward (cavity below the lip line)
# ---------------------------------------------------------------------------

def bezier(p0, p1, p2, n=40):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))
    return pts


def make_01_open() -> None:
    """A standalone open mouth for the w-mouth skin.

    The rig fades the base 11_mouth.png (w line + skin patch) out while the
    mouth opens (`mouth.hideBase`), so this overlay is the whole mouth: a dark
    cavity with a tongue, a straight upper-lip cut and a lower lip line, and no
    w line of its own.
    """
    # Silhouette redrawn from the user's outline: a wide, rounded mouth with a
    # bulging left cheek side, a straighter right wall and a flat-ish bottom.
    # Coordinates are in the unrotated art space (the rig applies
    # openRotation + openOffset; 15° + (-3,-4) at the moment).
    TL = (558.0, 460.4)
    TR = (597.0, 466.2)
    BR = (593.2, 484.4)
    BL = (558.8, 481.9)
    top = [TL, TR]
    right1 = bezier(TR, (598.5, 472.0), (597.8, 479.5), 20)
    right2 = bezier((597.8, 479.5), (597.0, 482.8), BR, 12)
    bottom = bezier(BR, (576.5, 488.6), BL, 40)
    left1 = bezier(BL, (555.1, 477.6), (555.5, 471.1), 20)
    left2 = bezier((555.5, 471.1), (555.8, 465.4), TL, 16)
    path = top + right1[1:] + right2[1:] + bottom[1:] + left1[1:] + left2[1:]
    box = (545, 448, 615, 494)
    z = 8
    cw, ch = (box[2] - box[0]) * z, (box[3] - box[1]) * z
    ox, oy = box[0] * z, box[1] * z
    crop = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))

    def t(p):
        return (p[0] * z - ox, p[1] * z - oy)

    mask = Image.new('L', (cw, ch), 0)
    ImageDraw.Draw(mask).polygon([t(p) for p in path], fill=255)
    grad = np.zeros((ch, cw, 4), dtype=np.uint8)
    for y in range(ch):
        k = y / max(1, ch - 1)
        grad[y, :, 0] = int(120 + (212 - 120) * k)
        grad[y, :, 1] = int(56 + (134 - 56) * k)
        grad[y, :, 2] = int(64 + (140 - 64) * k)
        grad[y, :, 3] = 255
    crop.paste(Image.fromarray(grad, 'RGBA'), (0, 0), mask)

    # tongue, kept low and partly hidden by the lower lip
    d = ImageDraw.Draw(crop)
    tx, ty = 579, 480.8
    d.ellipse([(tx - 10.5) * z - ox, (ty - 3.4) * z - oy,
               (tx + 10.5) * z - ox, (ty + 3.4) * z - oy], fill=(236, 164, 168, 255))
    d.ellipse([(tx - 8) * z - ox, (ty - 4.0) * z - oy,
               (tx + 8) * z - ox, (ty - 0.2) * z - oy], fill=(194, 104, 110, 100))

    # lower lip line only
    lip = [p for p in right1 + right2 + bottom + left1 if p[1] > 476]
    d.line([t(p) for p in lip], fill=(150, 98, 98, 235), width=int(1.9 * z), joint='curve')

    # Upper lip: cut the top straight along the user's latest redline (the old
    # top-left was too high).  That redline was drawn on the 15°-rotated
    # render, so this line is the redline rotated back into art space.
    arr = np.array(crop)
    xs = (np.arange(cw) + ox) / z
    cut = ((0.036 * xs + 446.2) * z - oy)[None, :]
    yy = np.arange(ch)[:, None]
    fade = np.clip((yy - cut) / z + 0.5, 0, 1)
    arr[:, :, 3] = (arr[:, :, 3] * fade).astype(np.uint8)
    crop = Image.fromarray(arr, 'RGBA')

    img = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    img.alpha_composite(crop.resize((box[2] - box[0], box[3] - box[1]), Image.LANCZOS),
                        (box[0], box[1]))
    save('feiyu-01', '11_mouth_open.png', img)


# ---------------------------------------------------------------------------
# open-mouth hole for a skin whose art has a closed mouth
# ---------------------------------------------------------------------------

def make_open_mouth(skin: str, canvas: int,
                    cx: float, cy: float, rx: float, ry: float,
                    outline: tuple[int, int, int, int],
                    inner_top: tuple[int, int, int],
                    inner_bottom: tuple[int, int, int],
                    tongue: tuple[float, float, float, float],
                    out_name: str) -> None:
    """Draw a soft oval mouth opening on a transparent canvas.

    tongue = (offset_x, offset_y, rx, ry) relative to the hole centre.
    """
    box = (int(cx - rx - 18), int(cy - ry - 18), int(cx + rx + 18), int(cy + ry + 18))
    z = 6
    cw, ch = (box[2] - box[0]) * z, (box[3] - box[1]) * z
    ox, oy = box[0] * z, box[1] * z
    crop = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    d = ImageDraw.Draw(crop)

    x0, y0 = (cx - rx) * z - ox, (cy - ry) * z - oy
    x1, y1 = (cx + rx) * z - ox, (cy + ry) * z - oy
    d.ellipse([x0, y0, x1, y1], fill=outline)

    inset = 2.2 * z
    mask = Image.new('L', (cw, ch), 0)
    ImageDraw.Draw(mask).ellipse([x0 + inset, y0 + inset, x1 - inset, y1 - inset], fill=255)
    crop.paste(vertical_gradient(cw, ch, inner_top, inner_bottom), (0, 0), mask)

    # darker upper cavity + tongue
    shadow = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    ds = ImageDraw.Draw(shadow)
    ds.ellipse([x0 + 2 * inset, y0 + inset, x1 - 2 * inset, y0 + (y1 - y0) * 0.5],
               fill=(64, 22, 27, 95))
    crop.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(1.6 * z)))

    tx, ty, trx, try_ = tongue
    tcx, tcy = (cx + tx) * z - ox, (cy + ty) * z - oy
    d.ellipse([tcx - trx * z, tcy - try_ * z, tcx + trx * z, tcy + try_ * z],
              fill=(244, 178, 182, 255))
    d.ellipse([tcx - trx * 0.8 * z, tcy - try_ * 1.3 * z, tcx + trx * 0.8 * z,
               tcy - try_ * 0.15 * z], fill=(196, 105, 112, 110))

    # tiny gloss
    d.arc([x0 + 2 * inset, y0 + 2 * inset, x1 - 2 * inset, y1 - 2 * inset],
          200, 250, fill=(255, 240, 236, 65), width=max(1, int(1.1 * z)))

    hole = blank(canvas)
    hole.alpha_composite(crop.resize((box[2] - box[0], box[3] - box[1]), Image.LANCZOS),
                         (box[0], box[1]))
    save(skin, out_name, hole)


def make_cover(skin: str, base_file: str, out_name: str,
               dark_test, dilate: int = 7, blur: float = 0.7) -> None:
    """Copy the skin's mouth patch, but erase the dark lip line / dot.

    Only RGB is changed; alpha is preserved exactly so the cover sits on top of
    the original mouth layer without a seam.
    """
    base = load(skin, base_file)
    arr = np.array(base)
    rgb = arr[:, :, :3].astype(np.int16)
    alpha = arr[:, :, 3]
    dark = dark_test(rgb, alpha)
    mask = Image.fromarray((dark * 255).astype(np.uint8), 'L').filter(ImageFilter.MaxFilter(dilate))
    keep = alpha > 120
    fill = np.median(arr[keep & ~dark][:, :3], axis=0)
    filled = arr.copy()
    filled[np.array(mask) > 0, :3] = fill
    filled_img = Image.fromarray(filled, 'RGBA').filter(ImageFilter.GaussianBlur(blur))
    # composite only inside the dilated mask so the rest stays pixel-identical
    cover = Image.composite(filled_img, base, mask)
    save(skin, out_name, cover)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    make_01_open()

    make_open_mouth(
        'feiyu-03', 1280,
        cx=646, cy=648, rx=25, ry=15,
        outline=(198, 121, 126, 255),
        inner_top=(130, 58, 69), inner_bottom=(214, 128, 135),
        tongue=(0, 9, 15, 5.5),
        out_name='10_mouth_open.png')
    make_cover(
        'feiyu-03', '10_mouth.png', '10_mouth_open_cover.png',
        dark_test=lambda rgb, a: (a > 40) & (
            (rgb[:, :, 0] < 235) | ((rgb[:, :, 0] - rgb[:, :, 1]) > 18) | ((rgb[:, :, 1] - rgb[:, :, 2]) > 14)))

    make_open_mouth(
        'feiyu-05', 1280,
        cx=653, cy=689.5, rx=12, ry=9.5,
        outline=(165, 117, 106, 255),
        inner_top=(112, 66, 69), inner_bottom=(205, 127, 120),
        tongue=(0, 3.5, 7, 3.6),
        out_name='12_mouth_open.png')
    make_cover(
        'feiyu-05', '12_mouth.png', '12_mouth_open_cover.png',
        dark_test=lambda rgb, a: (a > 100) & (rgb[:, :, 0] < 225),
        dilate=9, blur=0.8)


if __name__ == '__main__':
    main()
