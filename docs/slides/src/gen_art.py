"""Guilloche artwork for the AgentPay Guard deck (security-paper world)."""
import math
import numpy as np
from PIL import Image, ImageDraw

OUT = "art"
SS = 2  # supersample


def hexrgb(h, a=255):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (a,)


def finish(img, size):
    return img.resize(size, Image.LANCZOS)


def rosette(size=2400, color="9DB7C2", alpha=150, width=1):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = S / 2
    th = np.linspace(0, 2 * math.pi, 4000)

    def ring(r0, amp, m, n, phase_step, a, w, mod=0.0, mm=1):
        for k in range(n):
            ph = k * phase_step
            r = r0 + amp * np.sin(m * th + ph) + mod * np.sin(mm * th)
            pts = list(zip(c + r * np.cos(th), c + r * np.sin(th)))
            d.line(pts + [pts[0]], fill=hexrgb(color, a), width=w * SS)

    u = S / 2
    ring(0.88 * u, 0.05 * u, 60, 14, math.pi / 14, alpha, width)
    ring(0.71 * u, 0.08 * u, 36, 18, math.pi / 18, alpha, width, 0.02 * u, 6)
    ring(0.52 * u, 0.10 * u, 24, 22, math.pi / 22, alpha, width)
    # inner rose petals
    for k in range(20):
        ph = k * (2 * math.pi / 12) / 20
        r = 0.10 * u + (0.16 + 0.004 * k) * u * (0.5 + 0.5 * np.cos(12 * th + ph))
        pts = list(zip(c + r * np.cos(th), c + r * np.sin(th)))
        d.line(pts + [pts[0]], fill=hexrgb(color, int(alpha * 0.8)), width=width * SS)
    return finish(img, (size, size))


def waves(w=2667, h=1500, bg="E4ECEF", line="D3DFE4", n=70, amp=22, wl=520, lw=1, bands=True):
    W, H = w * SS, h * SS
    img = Image.new("RGBA", (W, H), hexrgb(bg))
    d = ImageDraw.Draw(img)
    xs = np.linspace(0, W, 1400)
    for i in range(n):
        y0 = (i / n) * H * 1.1 - H * 0.05
        ph = i * 0.21
        y = y0 + amp * SS * np.sin(2 * math.pi * xs / (wl * SS) + ph) + 0.5 * amp * SS * np.sin(2 * math.pi * xs / (wl * SS * 0.37) - ph)
        d.line(list(zip(xs, y)), fill=hexrgb(line), width=lw * SS)
    return finish(img, (w, h))


def card_texture(w=1500, h=820):
    """Cheque paper: pale tint with fine interference waves and a border guilloche."""
    W, H = w * SS, h * SS
    img = Image.new("RGBA", (W, H), hexrgb("F4F8F9"))
    d = ImageDraw.Draw(img)
    xs = np.linspace(0, W, 1200)
    for i in range(110):
        y0 = (i / 110) * H * 1.2 - H * 0.1
        y = y0 + 14 * SS * np.sin(2 * math.pi * xs / (300 * SS) + i * 0.35)
        d.line(list(zip(xs, y)), fill=hexrgb("DDE8EC"), width=SS)
    # border band of crossing sines
    m = 26 * SS
    for edge in ("top", "bottom"):
        base = m if edge == "top" else H - m
        for k in range(8):
            y = base + 12 * SS * np.sin(2 * math.pi * xs / (60 * SS) + k * math.pi / 8)
            d.line(list(zip(xs, y)), fill=hexrgb("9DB7C2", 170), width=SS)
    return finish(img, (w, h))


if __name__ == "__main__":
    import os
    os.makedirs(OUT, exist_ok=True)
    rosette(color="9DB7C2", alpha=120).save(f"{OUT}/rosette-dark.png")
    rosette(color="9DB7C2", alpha=170).save(f"{OUT}/rosette-light.png")
    rosette(size=1200, color="B3261E", alpha=150).save(f"{OUT}/rosette-red.png")
    waves().convert("RGB").save(f"{OUT}/paper.png")
    waves(bg="16303A", line="1D3B46", n=60, amp=26).convert("RGB").save(f"{OUT}/ink.png")
    card_texture().convert("RGB").save(f"{OUT}/cheque.png")
    card_texture(1400, 1075).convert("RGB").save(f"{OUT}/receipt.png")
    print("ok")
