import { useEffect, useRef } from 'react';

interface Blade {
  x: number;
  height: number;
  hue: number;
  saturation: number;
  lightness: number;
  opacity: number;
  phase: number;
  width: number;
}

function seedBlades(width: number): Blade[] {
  const count = Math.min(Math.floor(width * 0.25), 450);
  const blades: Blade[] = [];
  for (let i = 0; i < count; i++) {
    blades.push({
      x: Math.random() * width,
      height: 70 + Math.random() * 180,
      hue: 72 + Math.random() * 38,
      saturation: 25 + Math.random() * 20,
      lightness: 42 + Math.random() * 22,
      opacity: 0.06 + Math.random() * 0.09,
      phase: Math.random() * Math.PI * 2,
      width: 0.6 + Math.random() * 1.4,
    });
  }
  // sort by height so shorter (nearer) blades draw on top
  blades.sort((a, b) => b.height - a.height);
  return blades;
}

function getWind(x: number, t: number, phase: number): number {
  return Math.sin(x * 0.0065 + t * 0.55 + phase) * 22
       + Math.sin(x * 0.0025 + t * 0.28) * 16
       + Math.sin(x * 0.013 + t * 0.85 + phase * 0.4) * 9;
}

export function GrassBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // respect reduced motion
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motionQuery.matches) return;

    let animId: number;
    let blades: Blade[] = [];
    let w = 0;
    let h = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      w = window.innerWidth;
      h = window.innerHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = w + 'px';
      canvas!.style.height = h + 'px';
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      blades = seedBlades(w);
    }

    function draw(time: number) {
      const t = time * 0.001;
      ctx!.clearRect(0, 0, w, h);

      for (const blade of blades) {
        const wind = getWind(blade.x, t, blade.phase);
        const rootX = blade.x;
        const rootY = h;
        const tipX = rootX + wind;
        const tipY = h - blade.height;
        // control point bends less than the tip — creates a natural arc
        const cpX = rootX + wind * 0.35;
        const cpY = h - blade.height * 0.55;

        ctx!.beginPath();
        ctx!.moveTo(rootX, rootY);
        ctx!.quadraticCurveTo(cpX, cpY, tipX, tipY);
        ctx!.strokeStyle = `hsla(${blade.hue}, ${blade.saturation}%, ${blade.lightness}%, ${blade.opacity})`;
        ctx!.lineWidth = blade.width;
        ctx!.lineCap = 'round';
        ctx!.stroke();
      }

      animId = requestAnimationFrame(draw);
    }

    resize();
    animId = requestAnimationFrame(draw);
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0"
      style={{ zIndex: -1 }}
    />
  );
}
