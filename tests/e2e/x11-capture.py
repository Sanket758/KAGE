#!/usr/bin/env python3
"""Captures an X11 window to a PPM file using XGetImage.

Works without a compositor, unlike root screenshots of ARGB windows.

Usage: x11-capture.py WINDOW_ID WIDTH HEIGHT OUTPUT.ppm
"""
import ctypes
import sys

if len(sys.argv) != 5:
    sys.exit("usage: x11-capture.py WINDOW_ID WIDTH HEIGHT OUTPUT.ppm")

window_id = int(sys.argv[1], 0)
width = int(sys.argv[2])
height = int(sys.argv[3])
output = sys.argv[4]

try:
    x11 = ctypes.CDLL("libX11.so.6")
except OSError as error:
    sys.exit(f"missing libX11: {error}")


class XImage(ctypes.Structure):
    _fields_ = [
        ("width", ctypes.c_int),
        ("height", ctypes.c_int),
        ("xoffset", ctypes.c_int),
        ("format", ctypes.c_int),
        ("data", ctypes.c_void_p),
        ("byte_order", ctypes.c_int),
        ("bitmap_unit", ctypes.c_int),
        ("bitmap_bit_order", ctypes.c_int),
        ("bitmap_pad", ctypes.c_int),
        ("depth", ctypes.c_int),
        ("bytes_per_line", ctypes.c_int),
        ("bits_per_pixel", ctypes.c_int),
        ("red_mask", ctypes.c_ulong),
        ("green_mask", ctypes.c_ulong),
        ("blue_mask", ctypes.c_ulong),
        ("obdata", ctypes.c_void_p),
    ]


x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XGetImage.restype = ctypes.POINTER(XImage)
x11.XGetImage.argtypes = [
    ctypes.c_void_p,
    ctypes.c_ulong,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_uint,
    ctypes.c_uint,
    ctypes.c_ulong,
    ctypes.c_int,
]
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]

display = x11.XOpenDisplay(None)
if not display:
    sys.exit("cannot open display")

image_pointer = x11.XGetImage(display, window_id, 0, 0, width, height, 0xFFFFFFFF, 2)
if not image_pointer:
    sys.exit("XGetImage failed")

image = image_pointer.contents
stride = image.bytes_per_line
bpp = image.bits_per_pixel
data = ctypes.string_at(image.data, stride * height)


def channel(value, mask):
    if mask == 0:
        return 0
    shift = (mask & -mask).bit_length() - 1
    maximum = mask >> shift
    raw = (value & mask) >> shift
    return round(raw * 255 / maximum)


masked = image.red_mask != 0 or image.green_mask != 0 or image.blue_mask != 0
pixels = bytearray()

for y in range(height):
    row = data[y * stride : (y + 1) * stride]
    for x in range(width):
        offset = x * (bpp // 8)
        chunk = row[offset : offset + (bpp // 8)]
        if len(chunk) < 3:
            pixels.extend((0, 0, 0))
            continue
        if image.byte_order == 0:
            value = int.from_bytes(chunk, "little")
        else:
            value = int.from_bytes(chunk, "big")
        if masked:
            pixels.extend(
                (
                    channel(value, image.red_mask),
                    channel(value, image.green_mask),
                    channel(value, image.blue_mask),
                )
            )
        else:
            # Fall back to a byte-wise BGR interpretation.
            pixels.extend((chunk[2], chunk[1], chunk[0]))

with open(output, "wb") as handle:
    handle.write(f"P6\n{width} {height}\n255\n".encode())
    handle.write(pixels)

x11.XCloseDisplay(display)
print(f"captured {width}x{height} from window {hex(window_id)} to {output}")
