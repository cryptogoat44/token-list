/**
 * Rendu Canvas 2D de la scène de plongée — aucune dépendance React.
 *
 * Principe : le plongeur reste à une hauteur d'écran fixe, c'est le décor qui
 * défile vers le haut à la vitesse de descente réelle (dérivée de la
 * profondeur). L'obscurité, les rayons de lumière, la faune et les marqueurs
 * de profondeur sont tous indexés sur la profondeur courante du snapshot.
 */
import type { EngineEvent, EngineSnapshot } from "../../engine/types";

interface Bubble {
  x: number;
  y: number;
  r: number;
  vy: number;
  wobble: number;
  alpha: number;
}

interface Fish {
  worldDepth: number; // profondeur (m) à laquelle nage ce poisson
  x: number;
  vx: number;
  size: number;
  hue: number;
  wiggle: number;
}

interface Jelly {
  worldDepth: number;
  x: number;
  drift: number;
  size: number;
  phase: number;
}

interface Snow {
  x: number;
  y: number;
  r: number;
  vx: number;
}

interface FloatingLabel {
  x: number;
  y: number;
  text: string;
  age: number;
  color: string;
}

interface AscendingDiver {
  x: number;
  y: number;
  age: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Interpole deux couleurs RGB hex. */
function mixColor(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `rgb(${r},${g},${bl})`;
}

export class SceneRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;

  private bubbles: Bubble[] = [];
  private fishes: Fish[] = [];
  private jellies: Jelly[] = [];
  private snow: Snow[] = [];
  private labels: FloatingLabel[] = [];
  private ascending: AscendingDiver[] = [];

  private prevDepth = 0;
  private descentSpeed = 0; // m/s lissée
  private time = 0;
  private lastNow = 0;
  private crashAge = Number.POSITIVE_INFINITY; // s depuis la syncope
  private shake = 0;

  /** Pixels à l'écran par mètre de profondeur. */
  private readonly pxPerMeter = 7;
  /** Hauteur d'écran (fraction) où flotte le plongeur. */
  private readonly diverYRatio = 0.36;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D indisponible");
    this.ctx = ctx;
  }

  /** Réagit aux événements du moteur (effets ponctuels). */
  onEvents(events: EngineEvent[]): void {
    for (const e of events) {
      if (e.type === "cashedOut") {
        const x = this.width / 2 + (e.slot === 0 ? -40 : 40);
        const y = this.height * this.diverYRatio;
        this.labels.push({
          x,
          y,
          text: `+${(e.winCents / 100).toFixed(2)} (${e.multiplier.toFixed(2)}x)`,
          age: 0,
          color: "#6ee7b7",
        });
        this.ascending.push({ x: x + (Math.random() - 0.5) * 30, y, age: 0 });
        this.burstBubbles(x, y, 14);
      } else if (e.type === "crashed") {
        this.crashAge = 0;
        this.shake = 1;
        this.burstBubbles(this.width / 2, this.height * this.diverYRatio, 40);
      } else if (e.type === "phaseChanged" && e.phase === "BETTING") {
        this.crashAge = Number.POSITIVE_INFINITY;
      }
    }
  }

  private burstBubbles(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.bubbles.push({
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 40,
        r: 1.5 + Math.random() * 4,
        vy: 40 + Math.random() * 90,
        wobble: Math.random() * Math.PI * 2,
        alpha: 0.9,
      });
    }
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (
      clientWidth !== this.width ||
      clientHeight !== this.height ||
      dpr !== this.dpr
    ) {
      this.width = clientWidth;
      this.height = clientHeight;
      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(clientWidth * dpr));
      this.canvas.height = Math.max(1, Math.round(clientHeight * dpr));
    }
  }

  draw(snapshot: EngineSnapshot, now: number): void {
    this.resize();
    if (this.width === 0 || this.height === 0) return;
    const dt = Math.min(0.1, this.lastNow ? (now - this.lastNow) / 1000 : 0.016);
    this.lastNow = now;
    this.time += dt;
    if (Number.isFinite(this.crashAge)) this.crashAge += dt;

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const depth = snapshot.depthMeters;

    // Vitesse de descente lissée (m/s) — pilote le défilement du décor.
    const instSpeed = dt > 0 ? Math.max(0, (depth - this.prevDepth) / dt) : 0;
    this.descentSpeed = lerp(this.descentSpeed, instSpeed, 0.12);
    this.prevDepth = depth;
    const scroll = this.descentSpeed * this.pxPerMeter; // px/s vers le haut

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Tremblement bref à la syncope.
    if (this.shake > 0.01) {
      ctx.translate(
        (Math.random() - 0.5) * 10 * this.shake,
        (Math.random() - 0.5) * 10 * this.shake,
      );
      this.shake *= Math.exp(-dt * 6);
    }

    this.drawBackground(ctx, w, h, depth);
    this.drawSurfaceAndRays(ctx, w, h, depth);
    this.drawDepthMarkers(ctx, w, h, depth);
    this.updateAndDrawSnow(ctx, w, h, dt, scroll, depth);
    this.updateAndDrawFauna(ctx, w, h, dt, depth);
    this.updateAndDrawBubbles(ctx, dt, scroll);

    const diverX = w / 2;
    const diverY = h * this.diverYRatio;
    this.drawDiver(ctx, diverX, diverY, snapshot, depth);
    this.updateAndDrawAscending(ctx, dt);
    this.updateAndDrawLabels(ctx, dt);
    this.drawOxygenGauge(ctx, w, h, snapshot);
    this.drawCrashVignette(ctx, w, h, snapshot);

    ctx.restore();
  }

  // ───────────────────────────────────────────────────────────── décor

  private drawBackground(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    depth: number,
  ): void {
    // L'obscurité s'installe vite au début puis sature vers 300 m.
    const d = clamp01(Math.sqrt(depth / 300));
    const top = mixColor("#3fa7d6", "#020a14", d);
    const bottom = mixColor("#0a3a5c", "#000208", d);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  private drawSurfaceAndRays(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    depth: number,
  ): void {
    const diverY = h * this.diverYRatio;
    // Position écran de la surface (profondeur 0).
    const surfaceY = diverY - depth * this.pxPerMeter;
    if (surfaceY > -80) {
      // Vaguelettes de surface.
      ctx.beginPath();
      ctx.moveTo(0, surfaceY);
      for (let x = 0; x <= w; x += 12) {
        ctx.lineTo(x, surfaceY + Math.sin(x * 0.05 + this.time * 2.2) * 3);
      }
      ctx.strokeStyle = "rgba(220, 245, 255, 0.65)";
      ctx.lineWidth = 2;
      ctx.stroke();
      // Halo de ciel au-dessus de la surface.
      const sky = ctx.createLinearGradient(0, surfaceY - 80, 0, surfaceY);
      sky.addColorStop(0, "rgba(255, 244, 214, 0.9)");
      sky.addColorStop(1, "rgba(180, 230, 255, 0.15)");
      ctx.fillStyle = sky;
      ctx.fillRect(0, Math.max(-80, surfaceY - 80), w, Math.min(80, 80));
    }
    // Rayons de lumière, visibles dans les ~80 premiers mètres.
    const rayAlpha = 0.22 * (1 - clamp01(depth / 80));
    if (rayAlpha > 0.004) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 5; i++) {
        const baseX = w * (0.12 + i * 0.2) + Math.sin(this.time * 0.3 + i) * 30;
        const sway = Math.sin(this.time * 0.18 + i * 1.7) * 60;
        const grad = ctx.createLinearGradient(baseX, 0, baseX + sway, h);
        grad.addColorStop(0, `rgba(190, 235, 255, ${rayAlpha})`);
        grad.addColorStop(1, "rgba(190, 235, 255, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(baseX - 18, -10);
        ctx.lineTo(baseX + 18, -10);
        ctx.lineTo(baseX + sway + 60, h);
        ctx.lineTo(baseX + sway - 60, h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawDepthMarkers(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    depth: number,
  ): void {
    const diverY = h * this.diverYRatio;
    const every = depth > 400 ? 100 : depth > 120 ? 50 : 10; // espacement adaptatif
    const first = Math.max(every, Math.floor((depth - diverY / this.pxPerMeter) / every) * every);
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "left";
    for (let d = first; ; d += every) {
      const y = diverY + (d - depth) * this.pxPerMeter;
      if (y > h + 20) break;
      if (y < -20) continue;
      ctx.strokeStyle = "rgba(150, 210, 240, 0.10)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(160, 215, 245, 0.35)";
      ctx.fillText(`-${d} m`, 10, y - 4);
    }
  }

  private updateAndDrawSnow(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    dt: number,
    scroll: number,
    depth: number,
  ): void {
    // « Neige marine » : petites particules en suspension, plus denses au fond.
    const target = 40 + Math.round(clamp01(depth / 200) * 50);
    while (this.snow.length < target) {
      this.snow.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.6 + Math.random() * 1.6,
        vx: (Math.random() - 0.5) * 6,
      });
    }
    ctx.fillStyle = "rgba(200, 230, 250, 0.35)";
    for (const p of this.snow) {
      p.y -= (scroll * 0.9 + 4) * dt; // remonte = on descend
      p.x += p.vx * dt;
      if (p.y < -5) {
        p.y = h + 5;
        p.x = Math.random() * w;
      }
      if (p.x < -5) p.x = w + 5;
      if (p.x > w + 5) p.x = -5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private updateAndDrawFauna(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    dt: number,
    depth: number,
  ): void {
    const diverY = h * this.diverYRatio;
    const viewRange = h / this.pxPerMeter; // mètres visibles à l'écran

    // Poissons : on en maintient quelques-uns autour de la fenêtre visible.
    while (this.fishes.length < 7) {
      this.fishes.push({
        worldDepth: depth + (Math.random() * 1.6 - 0.3) * viewRange,
        x: Math.random() < 0.5 ? -40 : w + 40,
        vx: (12 + Math.random() * 30) * (Math.random() < 0.5 ? 1 : -1),
        size: 7 + Math.random() * 12,
        hue: 185 + Math.random() * 60,
        wiggle: Math.random() * Math.PI * 2,
      });
    }
    for (const f of this.fishes) {
      f.x += f.vx * dt;
      f.wiggle += dt * 6;
      const y = diverY + (f.worldDepth - depth) * this.pxPerMeter;
      const out =
        (f.vx > 0 && f.x > w + 60) || (f.vx < 0 && f.x < -60) || y < -120 || y > h + 120;
      if (out) {
        f.worldDepth = depth + (Math.random() * 1.4 + 0.15) * viewRange;
        f.vx = (12 + Math.random() * 30) * (Math.random() < 0.5 ? 1 : -1);
        f.x = f.vx > 0 ? -40 : w + 40;
        continue;
      }
      if (y < -30 || y > h + 30) continue;
      const wobbleY = y + Math.sin(f.wiggle) * 3;
      ctx.save();
      ctx.translate(f.x, wobbleY);
      ctx.scale(f.vx > 0 ? 1 : -1, 1);
      ctx.fillStyle = `hsla(${f.hue}, 45%, 62%, 0.5)`;
      // corps
      ctx.beginPath();
      ctx.ellipse(0, 0, f.size, f.size * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      // queue
      ctx.beginPath();
      ctx.moveTo(-f.size * 0.9, 0);
      ctx.lineTo(-f.size * 1.5, -f.size * 0.4);
      ctx.lineTo(-f.size * 1.5, f.size * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Méduses : lentes, en profondeur, légèrement lumineuses.
    while (this.jellies.length < 3) {
      this.jellies.push({
        worldDepth: depth + (0.3 + Math.random() * 1.4) * viewRange + 25,
        x: Math.random() * w,
        drift: (Math.random() - 0.5) * 8,
        size: 12 + Math.random() * 16,
        phase: Math.random() * Math.PI * 2,
      });
    }
    for (const j of this.jellies) {
      j.phase += dt * 1.6;
      j.x += j.drift * dt;
      j.worldDepth -= dt * 1.2; // les méduses remontent doucement
      const y = diverY + (j.worldDepth - depth) * this.pxPerMeter;
      if (y < -160 || j.x < -60 || j.x > w + 60) {
        j.worldDepth = depth + (0.6 + Math.random()) * viewRange + 30;
        j.x = Math.random() * w;
        continue;
      }
      if (y > h + 160) continue;
      const pulse = 1 + Math.sin(j.phase) * 0.12;
      ctx.save();
      ctx.translate(j.x, y);
      ctx.globalAlpha = 0.55;
      const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, j.size * 1.8);
      glow.addColorStop(0, "rgba(190, 160, 255, 0.5)");
      glow.addColorStop(1, "rgba(190, 160, 255, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(-j.size * 2, -j.size * 2, j.size * 4, j.size * 4);
      ctx.fillStyle = "rgba(205, 180, 255, 0.65)";
      ctx.beginPath();
      ctx.arc(0, 0, j.size * pulse, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(205, 180, 255, 0.45)";
      ctx.lineWidth = 1.5;
      for (let t = 0; t < 4; t++) {
        const tx = -j.size * 0.7 + (t * j.size * 1.4) / 3;
        ctx.beginPath();
        ctx.moveTo(tx * pulse, 2);
        ctx.quadraticCurveTo(
          tx + Math.sin(j.phase + t) * 5,
          j.size * 1.1,
          tx + Math.sin(j.phase * 1.3 + t) * 8,
          j.size * 1.9,
        );
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private updateAndDrawBubbles(
    ctx: CanvasRenderingContext2D,
    dt: number,
    scroll: number,
  ): void {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.wobble += dt * 5;
      b.y -= (b.vy + scroll) * dt;
      b.x += Math.sin(b.wobble) * 12 * dt;
      b.alpha -= dt * 0.25;
      if (b.y < -10 || b.alpha <= 0) {
        this.bubbles.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `rgba(210, 240, 255, ${Math.max(0, b.alpha) * 0.8})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ──────────────────────────────────────────────────────────── plongeur

  private drawDiver(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    snapshot: EngineSnapshot,
    depth: number,
  ): void {
    const phase = snapshot.phase;
    const crashed = phase === "CRASH" || (phase === "RESULT" && this.crashAge < 6);

    // Émission régulière de bulles pendant la descente.
    if (phase === "DIVING" && Math.random() < 0.25) {
      this.bubbles.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y - 14,
        r: 1 + Math.random() * 2.5,
        vy: 30 + Math.random() * 50,
        wobble: Math.random() * Math.PI * 2,
        alpha: 0.8,
      });
    }

    ctx.save();
    // À la surface (BETTING), le plongeur flotte ; en plongée il est tête en bas.
    const bob = Math.sin(this.time * 1.8) * 4;
    if (phase === "BETTING") {
      ctx.translate(x, y + bob);
      ctx.rotate(Math.sin(this.time * 0.9) * 0.06);
    } else if (crashed) {
      // Syncope : le corps part en vrille molle et dérive vers le haut.
      const drift = Math.min(1, this.crashAge / 2);
      ctx.translate(x + Math.sin(this.crashAge * 2) * 8, y - drift * 30 + bob * 0.4);
      ctx.rotate(Math.PI + Math.sin(this.crashAge * 1.5) * 0.8);
      ctx.globalAlpha = Math.max(0.35, 1 - drift * 0.5);
    } else {
      // Descente : tête en bas, ondulation de palmage.
      ctx.translate(x + Math.sin(this.time * 1.2) * 5, y + bob * 0.5);
      ctx.rotate(Math.PI + Math.sin(this.time * 2.4) * 0.05);
    }

    const kick = Math.sin(this.time * (phase === "DIVING" ? 7 : 2.5));
    const suit = "#16243d";
    const rim = crashed ? "rgba(255, 120, 120, 0.85)" : "rgba(110, 231, 255, 0.85)";

    ctx.lineWidth = 1.6;
    ctx.strokeStyle = rim;
    ctx.fillStyle = suit;

    // Tête + masque (vers le haut du repère local).
    ctx.beginPath();
    ctx.arc(0, -21, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = crashed ? "rgba(255,150,150,0.9)" : "rgba(140, 235, 255, 0.9)";
    ctx.fillRect(-5.5, -23.5, 11, 4); // visière

    // Bras tendus vers l'avant (position hydrodynamique).
    ctx.strokeStyle = rim;
    ctx.fillStyle = suit;
    ctx.beginPath();
    ctx.moveTo(-3, -26);
    ctx.quadraticCurveTo(-4, -36, -1.5, -40);
    ctx.moveTo(3, -26);
    ctx.quadraticCurveTo(4, -36, 1.5, -40);
    ctx.lineWidth = 3.4;
    ctx.stroke();

    // Torse fuselé.
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, -4, 7.5, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Jambes + ondulation.
    ctx.lineWidth = 4.4;
    ctx.beginPath();
    ctx.moveTo(-2.5, 7);
    ctx.quadraticCurveTo(-3 + kick * 2, 16, -2 + kick * 4, 24);
    ctx.moveTo(2.5, 7);
    ctx.quadraticCurveTo(3 - kick * 2, 16, 2 - kick * 4, 24);
    ctx.stroke();

    // Palmes.
    ctx.fillStyle = "#0d4f66";
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.2;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 2 - side * kick * -4, 25);
      ctx.rotate(side * 0.15 + kick * 0.35);
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.lineTo(3, 0);
      ctx.lineTo(5, 13);
      ctx.lineTo(-5, 13);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Lampe frontale dans l'obscurité (au-delà de ~80 m).
    const darkness = clamp01((depth - 80) / 120);
    if (darkness > 0 && !crashed) {
      ctx.globalCompositeOperation = "lighter";
      const beam = ctx.createRadialGradient(0, -30, 2, 0, -52, 46);
      beam.addColorStop(0, `rgba(255, 250, 200, ${0.5 * darkness})`);
      beam.addColorStop(1, "rgba(255, 250, 200, 0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(0, -26);
      ctx.lineTo(-26, -78);
      ctx.lineTo(26, -78);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private updateAndDrawAscending(ctx: CanvasRenderingContext2D, dt: number): void {
    for (let i = this.ascending.length - 1; i >= 0; i--) {
      const a = this.ascending[i];
      a.age += dt;
      a.y -= 90 * dt;
      if (a.age > 2.2 || a.y < -40) {
        this.ascending.splice(i, 1);
        continue;
      }
      const alpha = Math.max(0, 1 - a.age / 2.2);
      // Mini-silhouette stylisée qui file vers la surface : « remonté ! »
      ctx.save();
      ctx.translate(a.x + Math.sin(a.age * 6) * 6, a.y);
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = "rgba(110, 231, 183, 0.95)";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(0, 10);
      ctx.lineTo(0, -6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -10, 3.4, 0, Math.PI * 2);
      ctx.stroke();
      if (Math.random() < 0.4) {
        this.bubbles.push({
          x: a.x,
          y: a.y + 8,
          r: 1 + Math.random() * 1.6,
          vy: 50,
          wobble: Math.random() * 6,
          alpha: 0.7,
        });
      }
      ctx.restore();
    }
  }

  private updateAndDrawLabels(ctx: CanvasRenderingContext2D, dt: number): void {
    ctx.textAlign = "center";
    ctx.font = "600 15px system-ui, sans-serif";
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const l = this.labels[i];
      l.age += dt;
      l.y -= 28 * dt;
      if (l.age > 2.4) {
        this.labels.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.max(0, 1 - l.age / 2.4);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, l.x, l.y);
      ctx.globalAlpha = 1;
    }
  }

  // ───────────────────────────────────────────────────────── habillage

  /** Jauge d'apnée décorative : se vide avec la durée de la plongée. */
  private drawOxygenGauge(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    snapshot: EngineSnapshot,
  ): void {
    const diving = snapshot.phase === "DIVING";
    const over = snapshot.phase === "CRASH" || snapshot.phase === "RESULT";
    if (!diving && !over) return;
    // Purement visuel : ~vide après 45 s, plancher à 6 % (le vrai déclencheur
    // de fin de tour reste le crashPoint provably fair).
    const elapsed = snapshot.diveElapsedMs / 1000;
    const level = over ? 0.06 : Math.max(0.06, 1 - elapsed / 45);

    const gw = 10;
    const gh = Math.min(190, h * 0.4);
    const gx = w - 26;
    const gy = (h - gh) / 2;
    ctx.save();
    ctx.fillStyle = "rgba(8, 20, 35, 0.55)";
    ctx.strokeStyle = "rgba(140, 210, 240, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(gx - 2, gy - 2, gw + 4, gh + 4, 6);
    ctx.fill();
    ctx.stroke();

    const warning = level < 0.3;
    const pulse = warning ? 0.65 + Math.sin(this.time * 8) * 0.35 : 1;
    const color =
      level > 0.55
        ? "rgba(110, 231, 255, 0.9)"
        : level > 0.3
          ? "rgba(250, 204, 21, 0.9)"
          : `rgba(248, 113, 113, ${0.55 + 0.45 * pulse})`;
    ctx.fillStyle = color;
    const fillH = gh * level;
    ctx.beginPath();
    ctx.roundRect(gx, gy + (gh - fillH), gw, fillH, 4);
    ctx.fill();

    ctx.fillStyle = "rgba(170, 220, 245, 0.7)";
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("O₂", gx + gw / 2, gy - 8);
    ctx.restore();
  }

  /** Voile rouge + assombrissement au moment de la syncope. */
  private drawCrashVignette(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    snapshot: EngineSnapshot,
  ): void {
    if (snapshot.phase !== "CRASH" && snapshot.phase !== "RESULT") return;
    if (!Number.isFinite(this.crashAge)) return;
    const intensity =
      snapshot.phase === "CRASH"
        ? Math.min(1, this.crashAge * 3)
        : Math.max(0, 1 - (this.crashAge - 1.6) / 2);
    if (intensity <= 0) return;
    const grad = ctx.createRadialGradient(
      w / 2,
      h * this.diverYRatio,
      Math.min(w, h) * 0.18,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.75,
    );
    grad.addColorStop(0, "rgba(120, 10, 25, 0)");
    grad.addColorStop(1, `rgba(120, 10, 25, ${0.5 * intensity})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
}
