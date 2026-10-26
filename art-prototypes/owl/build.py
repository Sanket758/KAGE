#!/usr/bin/env python3
"""Crops the supplied owl sheet into transparent pose assets for the prototype.

The source is the user's own generated concept sheet. This script only removes
the white page, the panel dividers, the labels, and the ground shadow; it does
not redraw the character.

The sheet's panels are not equal sixths (the first one is wider), and the owl is
not centred in its panel, so each pose is aligned on the centroid of its dark
body pixels. All poses share the sheet's ground line, so feet stay level.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "mascot-ideas" / "Gemini_Generated_Image_f83cq3f83cq3f83c (3).jpeg"
OUT = Path(__file__).resolve().parent

NAMES = ["idle", "thinking", "typing", "building", "juggling", "conducting"]
LABELS = ["Idle", "Thinking", "Typing", "Building", "Juggling", "Conducting"]

# Vertical divider positions measured from the sheet.
PANELS = [(0, 500), (500, 937), (937, 1374), (1374, 1811), (1811, 2249), (2249, 2752)]

CROP_TOP = 420  # just above the tallest prop (thinking bubble at y=432)
CROP_BOTTOM = 845  # below the feet, above the ground shadow (851-875)
PANEL_INSET = 15
BODY_TOP = 560  # dark-pixel centroid is measured below this line
BODY_BOTTOM = 840
STAGE = (560, 470)
PASTE_Y = 40
GROUND_Y = 440  # feet rest here in every pose


def clean_halo(image: Image.Image) -> Image.Image:
    """Remove neutral, light pixels connected to the page.

    The sheet paints a soft grey ground shadow under the laptop and the blocks.
    The flood fill above leaves its lighter core behind, which reads as a ragged
    white patch on a dark desktop. Walking in from the transparent edge through
    neutral light pixels removes the shadow but stops at the coloured art.
    """
    width, height = image.size
    pixels = image.load()

    def removable(x: int, y: int) -> bool:
        r, g, b, a = pixels[x, y]
        return a > 0 and max(r, g, b) - min(r, g, b) <= 18 and (r + g + b) / 3 >= 190

    seen: set[tuple[int, int]] = set()
    stack: list[tuple[int, int]] = []

    for y in range(height):
        for x in range(width):
            if pixels[x, y][3] != 0:
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in seen and removable(nx, ny):
                    seen.add((nx, ny))
                    stack.append((nx, ny))

    while stack:
        x, y = stack.pop()
        pixels[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in seen and removable(nx, ny):
                seen.add((nx, ny))
                stack.append((nx, ny))

    return image


def crop_pose(sheet: Image.Image, index: int) -> Image.Image:
    x0, x1 = PANELS[index]
    crop = sheet.crop((x0 + PANEL_INSET, CROP_TOP, x1 - PANEL_INSET, CROP_BOTTOM))

    # Flood-fill the page from the corners. The threshold removes the white page
    # and the soft page glow, but stops at the owl's dark outline.
    for xy in ((0, 0), (crop.width - 1, 0), (0, crop.height - 1), (crop.width - 1, crop.height - 1)):
        ImageDraw.floodfill(crop, xy, (255, 255, 255, 0), thresh=40)

    crop = clean_halo(crop)

    # Align on the dark body rather than the crop box: the props (bubbles,
    # laptops, stars) would otherwise pull the owl off-centre between poses.
    pixels = crop.convert("RGB")
    body_top = BODY_TOP - CROP_TOP
    body_bottom = min(BODY_BOTTOM - CROP_TOP, crop.height)
    body = pixels.crop((0, body_top, crop.width, body_bottom))
    dark = [
        (x, y)
        for y in range(body.height)
        for x in range(body.width)
        if sum(body.getpixel((x, y))) / 3 < 95
    ]
    if dark:
        centre_x = sum(x for x, _ in dark) / len(dark)
    else:
        centre_x = crop.width / 2

    canvas = Image.new("RGBA", STAGE, (0, 0, 0, 0))
    canvas.alpha_composite(crop, (round(STAGE[0] / 2 - centre_x), PASTE_Y))
    return canvas


def build_contact_sheet(poses: list[Image.Image]) -> None:
    cell = (400, 336)
    label_h = 44
    sheet = Image.new("RGBA", (cell[0] * 3, (cell[1] + label_h) * 2), (24, 24, 32, 255))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
    except OSError:
        font = ImageFont.load_default()

    for index, (pose, label) in enumerate(zip(poses, LABELS, strict=True)):
        col, row = index % 3, index // 3
        x = col * cell[0]
        y = row * (cell[1] + label_h)
        tile = Image.new("RGBA", cell, (30, 30, 38, 255))
        thumb = pose.resize(cell, Image.LANCZOS)
        tile.alpha_composite(thumb, (0, 0))
        # Centre guide + ground line, to check body alignment at a glance.
        guide = ImageDraw.Draw(tile)
        guide.line((cell[0] // 2, 0, cell[0] // 2, cell[1]), fill=(255, 90, 90, 90), width=1)
        guide.line((0, GROUND_Y * cell[1] / STAGE[1], cell[0], GROUND_Y * cell[1] / STAGE[1]), fill=(90, 160, 255, 90), width=1)
        sheet.alpha_composite(tile, (x, y))
        bbox = draw.textbbox((0, 0), label, font=font)
        draw.text(
            (x + (cell[0] - (bbox[2] - bbox[0])) / 2, y + cell[1] + 12),
            label,
            font=font,
            fill=(232, 232, 240, 255),
        )

    sheet.convert("RGB").save(OUT / "contact-sheet.png", quality=95)


def main() -> None:
    sheet = Image.open(SOURCE).convert("RGBA")
    poses = [crop_pose(sheet, index) for index in range(6)]
    poses_dir = OUT / "poses"
    poses_dir.mkdir(parents=True, exist_ok=True)
    for name, pose in zip(NAMES, poses, strict=True):
        pose.save(poses_dir / f"{name}.png")
    build_contact_sheet(poses)
    print(f"wrote {len(poses)} poses to {poses_dir}")


if __name__ == "__main__":
    main()
