#!/usr/bin/env python3
"""
The app icon, drawn rather than committed as a binary nobody can review.

Run:  python3 design/scripts/generate-icon.py
Out:  ios/App/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png

Why a script: the Xcode project itself is generated from thirty lines of
`project.yml` so that what is reviewed is the source and not the artefact. An
icon pasted in as a PNG is the one thing in the bundle nobody can diff. This
draws it from the same palette the rest of the app uses — change
`design/tokens.json` and the icon follows.

The design, and the reasons:

  * A single beat that settles and then rises. The beat says what kind of app
    this is in the half-second anybody spends on an icon; the rise says what
    it is for, which is not monitoring but following somebody until they are
    better. A plain pulse was drawn and rejected for saying only the first
    half — and for being the most common mark in the category.

  * No cross. A red cross on white is a protected emblem under the Geneva
    Conventions; using it is unlawful in most of the countries this clinic
    treats people from.

  * No text. At 40 points a word is a smudge, and the system writes the name
    under the icon anyway.

  * No transparency and no rounded corners baked in: the App Store refuses an
    icon with an alpha channel, and iOS applies its own mask.

  * Stroke weight and the size of the end point were chosen by rendering the
    candidates at 240, 120, 80, 40 and 29 points behind the real mask and
    looking at them. Thinner lost the beat at 29; thicker closed the gap
    between the beat and the rise into a blob.

  * Drawn at 4× and downsampled, which is how the strokes get clean edges:
    PIL has no antialiasing for wide lines.
"""

import json
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(
    ROOT, 'ios', 'App', 'Resources', 'Assets.xcassets', 'AppIcon.appiconset', 'icon-1024.png'
)

SIZE = 1024
SCALE = 4
CANVAS = SIZE * SCALE


def rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def bezier(start, control, end, steps=80):
    """A quadratic curve, as points. The rise is a curve rather than a
    straight line because recovery is not a ramp."""
    return [
        (
            (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * control[0] + t * t * end[0],
            (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * control[1] + t * t * end[1],
        )
        for t in (i / steps for i in range(steps + 1))
    ]


def main() -> None:
    tokens = json.load(open(os.path.join(ROOT, 'design', 'tokens.json')))
    accent = rgb(tokens['color']['light']['accent'])

    # The accent, and a deeper version of it. A flat fill reads as a
    # placeholder; two stops of the same hue read as a considered surface.
    top = mix(accent, (255, 255, 255), 0.10)
    bottom = mix(accent, (0, 0, 0), 0.42)

    image = Image.new('RGB', (CANVAS, CANVAS), top)
    draw = ImageDraw.Draw(image)

    # Light from the top, the way every other surface in the app is lit.
    for y in range(CANVAS):
        draw.line([(0, y), (CANVAS, y)], fill=mix(top, bottom, y / CANVAS))

    white = (255, 255, 255)
    stroke = round(CANVAS * 0.082)

    # Fractions of the canvas, so the composition does not depend on the size
    # it is rendered at. Shifted left of centre and a hair down: the end point
    # is heavy, and an icon centred on its geometry looks off-centre.
    beat = 0.30
    base = 0.57

    pulse = [
        (0.12, base),
        (beat - 0.07, base),
        (beat - 0.02, 0.41),
        (beat + 0.05, 0.73),
        (beat + 0.10, base),
        (beat + 0.16, base),
    ]
    draw.line(
        [(round(x * CANVAS), round(y * CANVAS)) for x, y in pulse],
        fill=white,
        width=stroke,
        joint='curve',
    )

    rise = bezier(
        ((beat + 0.16) * CANVAS, base * CANVAS),
        ((beat + 0.30) * CANVAS, base * CANVAS),
        (0.79 * CANVAS, 0.31 * CANVAS),
    )
    draw.line(
        [(round(x), round(y)) for x, y in rise],
        fill=white,
        width=stroke,
        joint='curve',
    )

    # The latest reading, marked. The line has to end somewhere, and a blunt
    # end reads as a line that was cut off.
    radius = round(CANVAS * 0.090)
    x, y = rise[-1]
    draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=white)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    image.resize((SIZE, SIZE), Image.LANCZOS).save(OUT, 'PNG')

    print(f'{os.path.relpath(OUT, ROOT)}  {SIZE}×{SIZE}, no alpha')


if __name__ == '__main__':
    main()
