#!/usr/bin/env python3
"""Generate the snip .pkg installer background: a chunky, "pixelly"
white-to-burnt-orange gradient that matches the snip brand (#C2410C).

The macOS Installer places this image behind the wizard, anchored bottom-left,
and scales it to fit (`scaling: "tofit"` in package.json). A short image would
get stretched to the full window height — so instead we bake the layout into
the pixels: the canvas matches the installer-pane aspect, the burnt-orange
gradient occupies only the BOTTOM HALF, and the top half is plain white that
blends seamlessly into the installer's own white background. The result reads
as a gradient that fills the bottom ~50% and aligns to the bottom, regardless
of how the installer scales it.

Output: desktop/resources/pkg-background.png

Re-run after changing colors/size; commit the PNG (CI does not regenerate it).
"""

import os

from PIL import Image

# Full-pane canvas (~the installer window's 1.48:1 aspect, at 2x for crispness).
# The gradient is confined to the bottom GRADIENT_FRACTION; the rest is white so
# the artwork sits in the lower half and never stretches to full height.
WIDTH = 1200
HEIGHT = 820
GRADIENT_FRACTION = 0.5  # gradient occupies the bottom half; top stays white
BLOCK = 20  # size of one "pixel" block in the final image

# Brand ramp: cream-white at the top → burnt orange at the bottom, easing
# through the light highlight orange so the warmth builds gradually.
TOP = (255, 255, 255)        # white
MID = (253, 186, 116)        # #FDBA74 highlight wash
BOTTOM = (194, 65, 12)       # #C2410C burnt orange

# 4x4 Bayer matrix (values 0..15) → normalized threshold for ordered dithering.
BAYER4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
]


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def ramp(t):
    """t is the vertical position over the whole canvas (0 top → 1 bottom).
    The top (1 - GRADIENT_FRACTION) stays pure white so it blends into the
    installer's white background; the bottom GRADIENT_FRACTION runs the
    two-stop white→mid→orange ramp. This is what confines the gradient to the
    lower half and keeps it bottom-aligned."""
    split = 1.0 - GRADIENT_FRACTION
    if t <= split:
        return TOP
    u = (t - split) / GRADIENT_FRACTION  # 0..1 across the gradient band
    if u <= 0.55:
        return lerp(TOP, MID, u / 0.55)
    return lerp(MID, BOTTOM, (u - 0.55) / 0.45)


def main():
    cols = WIDTH // BLOCK
    rows = HEIGHT // BLOCK
    small = Image.new("RGB", (cols, rows))
    px = small.load()

    # Spread the dither over a few block-rows so bands interleave visibly.
    spread = 3.0 / max(rows, 1)
    for by in range(rows):
        # Vertical position 0..1 of this block row.
        t = by / max(rows - 1, 1)
        for bx in range(cols):
            # Ordered dither: nudge each block lighter/darker based on the
            # Bayer threshold so adjacent bands interleave into a pixelly
            # checker instead of a hard line.
            threshold = (BAYER4[by % 4][bx % 4] + 0.5) / 16.0
            t_dither = min(max(t + (threshold - 0.5) * spread, 0.0), 1.0)
            px[bx, by] = ramp(t_dither)

    # Upscale with nearest-neighbor to keep the blocks crisp.
    big = small.resize((cols * BLOCK, rows * BLOCK), Image.NEAREST)

    out = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "resources",
        "pkg-background.png",
    )
    big.save(out, "PNG")
    print(f"wrote {out} ({big.width}x{big.height}, block={BLOCK})")


if __name__ == "__main__":
    main()
