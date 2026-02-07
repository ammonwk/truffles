#!/usr/bin/env python3
"""
Convert an MP4 video into a compact binary format for the AsciiPlayer component.

Uses structural matching: for each cell, every printable ASCII character is rendered
in the target font, and the character whose pixel pattern best matches the source
image region is selected. This gives dramatically better ASCII art than simple
brightness/density ramps because characters are chosen for shape, not just density.

Output format (little-endian):
  Header:    uint16 cols, uint16 rows, uint16 fps, uint16 frameCount  (8 bytes)
  CharCount: uint8 numChars                                            (1 byte)
  CharTable: numChars bytes (the printable ASCII chars used, in order)  (variable)
  Palette:   256 * 3 bytes (RGB)                                        (768 bytes)
  Frames:    frameCount * (cols * rows * 2) bytes per frame
             Per cell: [charTableIndex (u8), colorPaletteIndex (u8)]

Usage:
  python3 convert-video-to-ascii.py <input.mp4> <output.bin> [--fps 12] [--cols 120]
"""

import argparse
import os
import struct
import subprocess
import tempfile

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from sklearn.cluster import MiniBatchKMeans


def get_monospace_font(size: int) -> ImageFont.FreeTypeFont:
    """Try to load a monospace font, fall back to default."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
        "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
        "/System/Library/Fonts/Courier.dfont",
        "/usr/share/fonts/truetype/ubuntu/UbuntuMono-R.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def build_glyph_templates(
    font: ImageFont.FreeTypeFont, cell_w: int, cell_h: int,
) -> tuple[list[str], np.ndarray]:
    """
    Render every printable ASCII character and return:
    - chars: list of characters used
    - templates: (N, cell_h, cell_w) float32 array of normalized brightness [0,1]
    """
    chars = []
    templates = []

    for code in range(32, 127):
        ch = chr(code)
        img = Image.new("L", (cell_w, cell_h), 0)
        draw = ImageDraw.Draw(img)
        draw.text((0, 0), ch, fill=255, font=font)
        arr = np.array(img, dtype=np.float32) / 255.0
        chars.append(ch)
        templates.append(arr)

    templates = np.array(templates)  # (N, cell_h, cell_w)
    return chars, templates


def structural_match_frame(
    frame_gray: np.ndarray,
    frame_rgb: np.ndarray,
    templates: np.ndarray,
    template_norms: np.ndarray,
    kmeans: MiniBatchKMeans,
    cols: int,
    rows: int,
    cell_w: int,
    cell_h: int,
) -> np.ndarray:
    """
    For each cell in the frame, find the character template that best matches
    the source image region using normalized cross-correlation.
    Returns flat array of [charIdx, colorIdx] per cell.
    """
    n_templates = templates.shape[0]
    # Reshape templates for vectorized comparison: (N, cell_h * cell_w)
    flat_templates = templates.reshape(n_templates, -1)

    result = np.empty((rows, cols, 2), dtype=np.uint8)

    for row in range(rows):
        for col in range(cols):
            y0 = row * cell_h
            x0 = col * cell_w
            region = frame_gray[y0 : y0 + cell_h, x0 : x0 + cell_w]

            # Normalize region
            region_flat = region.flatten().astype(np.float32) / 255.0
            region_norm = np.linalg.norm(region_flat)

            if region_norm < 1e-6:
                # Nearly black region → space character (index 0)
                result[row, col, 0] = 0
            else:
                # Normalized cross-correlation: dot(template, region) / (|template| * |region|)
                dots = flat_templates @ region_flat
                scores = dots / (template_norms * region_norm + 1e-8)
                result[row, col, 0] = np.argmax(scores)

            # Color: average color of the region, quantized to palette
            rgb_region = frame_rgb[y0 : y0 + cell_h, x0 : x0 + cell_w]
            avg_color = rgb_region.reshape(-1, 3).mean(axis=0).reshape(1, -1)
            result[row, col, 1] = kmeans.predict(avg_color)[0]

    return result.flatten()


def extract_frames(
    video_path: str, out_dir: str, fps: int, width: int, height: int,
) -> list[str]:
    """Extract frames from video using ffmpeg."""
    pattern = os.path.join(out_dir, "frame_%04d.png")
    cmd = [
        "ffmpeg", "-i", video_path,
        "-vf", f"fps={fps},scale={width}:{height}:flags=lanczos",
        "-pix_fmt", "rgb24",
        "-y", pattern,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    frames = sorted(
        os.path.join(out_dir, f) for f in os.listdir(out_dir) if f.endswith(".png")
    )
    print(f"  Extracted {len(frames)} frames at {fps}fps, {width}x{height}")
    return frames


def build_palette(
    frames: list[np.ndarray], n_colors: int = 256,
) -> tuple[np.ndarray, MiniBatchKMeans]:
    """Build a global color palette from all frames."""
    all_pixels = np.concatenate([f.reshape(-1, 3) for f in frames])
    sample = all_pixels[::8].astype(np.float64)
    print(f"  Clustering {len(sample)} sampled pixels into {n_colors} colors...")
    kmeans = MiniBatchKMeans(
        n_clusters=n_colors, random_state=42, batch_size=2048, n_init=3,
    )
    kmeans.fit(sample)
    palette = kmeans.cluster_centers_.astype(np.uint8)
    print(f"  Palette built ({n_colors} colors)")
    return palette, kmeans


def main():
    parser = argparse.ArgumentParser(
        description="Convert video to ASCII animation binary (structural matching)",
    )
    parser.add_argument("input", help="Input MP4 video path")
    parser.add_argument("output", help="Output binary file path")
    parser.add_argument("--fps", type=int, default=12, help="Target frame rate (default: 12)")
    parser.add_argument("--cols", type=int, default=120, help="Character columns (default: 120)")
    args = parser.parse_args()

    # Font setup — render glyphs at this size to build templates
    glyph_font_size = 16
    font = get_monospace_font(glyph_font_size)

    # Measure cell dimensions from the font
    test_img = Image.new("L", (100, 100), 0)
    test_draw = ImageDraw.Draw(test_img)
    bbox = test_draw.textbbox((0, 0), "@", font=font)
    cell_w = bbox[2] - bbox[0]
    cell_h = bbox[3] - bbox[1]
    # Ensure minimum dimensions
    cell_w = max(cell_w, 8)
    cell_h = max(cell_h, 14)

    cols = args.cols
    rows = round(cols * 9 / 16 * (cell_w / cell_h))

    # Pixel dimensions of extracted frames must match cols*cell_w x rows*cell_h
    pixel_w = cols * cell_w
    pixel_h = rows * cell_h

    print(f"Config: {cols} cols x {rows} rows, cell={cell_w}x{cell_h}px, {args.fps}fps")
    print(f"  Frame pixel size: {pixel_w}x{pixel_h}")

    # Build character templates
    print("Step 1: Building glyph templates...")
    chars, templates = build_glyph_templates(font, cell_w, cell_h)
    flat_templates = templates.reshape(len(chars), -1)
    template_norms = np.linalg.norm(flat_templates, axis=1)
    print(f"  Built {len(chars)} character templates ({cell_w}x{cell_h}px each)")

    with tempfile.TemporaryDirectory() as tmp_dir:
        print("Step 2: Extracting frames...")
        frame_paths = extract_frames(args.input, tmp_dir, args.fps, pixel_w, pixel_h)

        print("Step 3: Loading frames...")
        frames_rgb = []
        frames_gray = []
        for path in frame_paths:
            img = Image.open(path).convert("RGB")
            frames_rgb.append(np.array(img))
            frames_gray.append(np.array(img.convert("L")))
        print(f"  Loaded {len(frames_rgb)} frames")

        print("Step 4: Building color palette...")
        palette, kmeans = build_palette(frames_rgb)

        print("Step 5: Structural matching (this may take a minute)...")
        frames_data = []
        for i in range(len(frames_rgb)):
            frame_result = structural_match_frame(
                frames_gray[i],
                frames_rgb[i],
                templates,
                template_norms,
                kmeans,
                cols,
                rows,
                cell_w,
                cell_h,
            )
            frames_data.append(frame_result)
            if (i + 1) % 10 == 0 or (i + 1) == len(frames_rgb):
                print(f"  Processed {i + 1}/{len(frames_rgb)} frames")

    # Write binary
    print("Step 6: Writing binary...")
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    frame_count = len(frames_data)

    char_bytes = "".join(chars).encode("ascii")

    with open(args.output, "wb") as f:
        # Header
        f.write(struct.pack("<HHHH", cols, rows, args.fps, frame_count))
        # Char table
        f.write(struct.pack("<B", len(chars)))
        f.write(char_bytes)
        # Palette
        f.write(palette.tobytes())
        # Frames
        for frame in frames_data:
            f.write(frame.tobytes())

    file_size = os.path.getsize(args.output)
    frame_size = cols * rows * 2
    print(f"\nDone! Output: {args.output}")
    print(f"  File size: {file_size:,} bytes ({file_size / 1024:.1f} KB)")
    print(f"  Frames: {frame_count}, Frame size: {frame_size} bytes")
    print(f"  Characters used: {len(chars)}")


if __name__ == "__main__":
    main()
