#!/usr/bin/env python3
"""Generate the snip .pkg installer background: a chunky, "pixelly"
white-to-burnt-orange gradient that matches the snip brand (#C2410C).

The macOS Installer shows this image behind the wizard. We render the gradient
at a low block resolution and upscale with nearest-neighbor so the transition
reads as deliberate retro pixel blocks (ordered/Bayer dithering at the band
edges) rather than a smooth photographic ramp.

Output: desktop/resources/pkg-background.png

Re-run after changing colors/size; commit the PNG (CI does not regenerate it).
"""

import os

from PIL import Image

# Final image size. The installer scales "tofit", so this only needs to be
# large enough to look crisp on retina. We render the gradient in BLOCK-sized
# cells then upscale, so the on-screen pixels stay chunky regardless.
WIDTH = 1200
HEIGHT = 820
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
    """Two-stop ramp: white→mid for the first 55%, mid→orange after."""
    if t <= 0.55:
        return lerp(TOP, MID, t / 0.55)
    return lerp(MID, BOTTOM, (t - 0.55) / 0.45)


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
