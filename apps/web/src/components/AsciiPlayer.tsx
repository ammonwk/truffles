import { useEffect, useRef, useState } from 'react';

interface AsciiAnimationData {
  cols: number;
  rows: number;
  fps: number;
  frameCount: number;
  chars: string[];
  palette: Uint8Array;
  frames: Uint8Array[];
}

async function loadAnimationData(url: string): Promise<AsciiAnimationData> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const view = new DataView(buf);

  const cols = view.getUint16(0, true);
  const rows = view.getUint16(2, true);
  const fps = view.getUint16(4, true);
  const frameCount = view.getUint16(6, true);

  let offset = 8;

  const numChars = view.getUint8(offset);
  offset += 1;
  const charBytes = new Uint8Array(buf, offset, numChars);
  const chars = Array.from(charBytes, (b) => String.fromCharCode(b));
  offset += numChars;

  const palette = new Uint8Array(buf, offset, 768);
  offset += 768;

  const frameSize = cols * rows * 2;
  const frames: Uint8Array[] = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push(new Uint8Array(buf, offset + i * frameSize, frameSize));
  }

  return { cols, rows, fps, frameCount, chars, palette, frames };
}

/** Escape HTML-special characters for safe innerHTML use. */
function esc(ch: string): string {
  if (ch === '<') return '&lt;';
  if (ch === '>') return '&gt;';
  if (ch === '&') return '&amp;';
  if (ch === '"') return '&quot;';
  return ch;
}

/**
 * Fade palette colors: desaturate toward luminance and adjust brightness.
 * Optionally produces background rgba strings at a given alpha.
 */
function fadePalette(
  palette: Uint8Array,
  saturation: number,
  brightness: number,
  bgAlpha: number = 0,
): { fg: string[]; bg: string[] } {
  const fg: string[] = [];
  const bg: string[] = [];
  for (let i = 0; i < 256; i++) {
    const or = palette[i * 3];
    const og = palette[i * 3 + 1];
    const ob = palette[i * 3 + 2];

    // Desaturate: lerp toward luminance
    const lum = 0.2126 * or + 0.7152 * og + 0.0722 * ob;
    const dr = Math.round(lum + (or - lum) * saturation);
    const dg = Math.round(lum + (og - lum) * saturation);
    const db = Math.round(lum + (ob - lum) * saturation);

    // Brightness for foreground
    const r = Math.min(255, Math.max(0, Math.round(dr * brightness)));
    const g = Math.min(255, Math.max(0, Math.round(dg * brightness)));
    const b = Math.min(255, Math.max(0, Math.round(db * brightness)));

    fg.push(
      '#' +
        r.toString(16).padStart(2, '0') +
        g.toString(16).padStart(2, '0') +
        b.toString(16).padStart(2, '0'),
    );

    // Background: original color at low alpha (unmodified hue, subtle wash)
    if (bgAlpha > 0) {
      bg.push(`rgba(${or},${og},${ob},${bgAlpha})`);
    }
  }
  return { fg, bg };
}

/**
 * Pre-build all frames as HTML strings. Consecutive characters that share the
 * same color are batched into a single <span> to minimise DOM element count.
 */
function buildFrameHtml(
  frames: Uint8Array[],
  chars: string[],
  paletteFg: string[],
  paletteBg: string[],
  cols: number,
  rows: number,
  colored: boolean,
): string[] {
  const hasBg = paletteBg.length > 0;
  const htmlFrames: string[] = [];

  for (const frame of frames) {
    const parts: string[] = [];
    let runKey = '';   // colorIdx as string — fg (and bg) both derive from it
    let runChars = '';

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = (row * cols + col) * 2;
        const charIdx = frame[idx];
        const colorIdx = frame[idx + 1];
        const ch = chars[charIdx];
        const key = String(colorIdx);

        if (!colored) {
          parts.push(esc(ch));
          continue;
        }

        if (!hasBg && ch === ' ') {
          // No bg tinting — spaces don't need spans
          if (runChars) {
            parts.push(`<span style="color:${paletteFg[+runKey]}">${runChars}</span>`);
            runChars = '';
          }
          parts.push(' ');
        } else if (key === runKey) {
          runChars += esc(ch);
        } else {
          if (runChars) {
            const style = hasBg
              ? `color:${paletteFg[+runKey]};background:${paletteBg[+runKey]}`
              : `color:${paletteFg[+runKey]}`;
            parts.push(`<span style="${style}">${runChars}</span>`);
          }
          runKey = key;
          runChars = esc(ch);
        }
      }
      if (colored && runChars) {
        const style = hasBg
          ? `color:${paletteFg[+runKey]};background:${paletteBg[+runKey]}`
          : `color:${paletteFg[+runKey]}`;
        parts.push(`<span style="${style}">${runChars}</span>`);
        runChars = '';
      }
      if (row < rows - 1) parts.push('\n');
    }

    htmlFrames.push(parts.join(''));
  }

  return htmlFrames;
}

export function AsciiPlayer({ src, className, colored = true }: { src: string; className?: string; colored?: boolean }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!preRef.current) return;

    let cancelled = false;
    let rafId = 0;
    let selecting = false;

    function buildFrames(data: AsciiAnimationData): string[] {
      const { palette, frames, chars, cols, rows } = data;
      if (!colored) {
        return buildFrameHtml(frames, chars, [], [], cols, rows, false);
      }
      const { fg, bg } = fadePalette(palette, 0.55, 0.82, 0);
      return buildFrameHtml(frames, chars, fg, bg, cols, rows, true);
    }

    // Pause animation while user is selecting text so the DOM stays stable
    const el = preRef.current!;
    const onMouseDown = () => { selecting = true; };
    const onMouseUp = () => { selecting = false; };
    el.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);

    (async () => {
      const data = await loadAnimationData(src);
      if (cancelled) return;

      const htmlFrames = buildFrames(data);

      let frameIndex = 0;
      let lastTime = 0;
      const interval = 1000 / data.fps;

      setLoaded(true);

      function render(timestamp: number) {
        if (cancelled) return;

        if (!selecting && timestamp - lastTime >= interval) {
          lastTime = timestamp - ((timestamp - lastTime) % interval);
          el.innerHTML = htmlFrames[frameIndex];
          frameIndex = (frameIndex + 1) % htmlFrames.length;
        }

        rafId = requestAnimationFrame(render);
      }

      rafId = requestAnimationFrame(render);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      el.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [src, colored]);

  return (
    <pre
      ref={preRef}
      className={className}
      style={{
        margin: 0,
        fontFamily: '"Courier New", Courier, monospace',
        fontSize: '14px',
        lineHeight: 1,
        letterSpacing: 0,
        color: colored ? undefined : 'var(--text-secondary)',
        background: '#0c1017',
        padding: '8px',
        opacity: loaded ? 1 : 0,
        transition: 'opacity 0.6s ease, background 0.18s ease',
        userSelect: 'text',
        cursor: 'text',
      }}
    />
  );
}
