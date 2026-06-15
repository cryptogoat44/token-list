/**
 * Scène principale : canvas plein cadre + surcouches DOM (multiplicateur,
 * profondeur, compte à rebours, syncope). Les textes restent en DOM pour
 * l'accessibilité (ARIA) et la netteté.
 */
import { useEffect, useRef } from "react";
import type { GameEngine } from "../../engine/engine";
import type { EngineSnapshot } from "../../engine/types";
import { formatDepth, formatMultiplier, multiplierColor } from "../format";
import { SceneRenderer } from "./renderer";

interface Props {
  engine: GameEngine;
  snapshot: EngineSnapshot;
  /** Couleurs des cosmétiques sélectionnés (combinaison, traînée de bulles). */
  suitColor: string;
  trailColor: string;
}

export function DiveScene({ engine, snapshot, suitColor, trailColor }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new SceneRenderer(canvas);
    rendererRef.current = renderer;
    renderer.setCosmetics(suitColor, trailColor);
    const unsubscribe = engine.subscribe((_snap, events) => {
      if (events.length > 0) renderer.onEvents(events);
    });
    let raf = 0;
    const loop = (t: number) => {
      renderer.draw(engine.getSnapshot(), t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  // Met à jour les cosmétiques à chaud quand le joueur en change.
  useEffect(() => {
    rendererRef.current?.setCosmetics(suitColor, trailColor);
  }, [suitColor, trailColor]);

  const { phase, multiplier, depthMeters, bettingEndsAt, now } = snapshot;
  const countdown = Math.max(0, (bettingEndsAt - now) / 1000);
  const countdownTotal = engine.config.bettingDurationMs / 1000;
  const crashed = phase === "CRASH" || phase === "RESULT";

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-cyan-400/15 bg-slate-950 shadow-[0_0_60px_-15px_rgba(34,211,238,0.25)]"
      style={{ aspectRatio: "16 / 10", minHeight: 320 }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

      {/* Multiplicateur central */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        {snapshot.syncing ? (
          <div className="text-center">
            <p className="text-sm uppercase tracking-[0.3em] text-emerald-200/80">
              Synchronisation du lobby…
            </p>
            <div
              className="mx-auto mt-4 h-8 w-8 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-300"
              aria-hidden="true"
            />
            <p className="mt-3 text-xs text-slate-400">
              On vous place sur la partie en cours, commune à tous les joueurs.
            </p>
          </div>
        ) : phase === "BETTING" ? (
          <div className="text-center">
            <p className="text-sm uppercase tracking-[0.3em] text-cyan-200/80">
              Prise d'air… plongée dans
            </p>
            <p
              className="mt-1 font-mono text-6xl font-bold text-cyan-100 drop-shadow-[0_0_18px_rgba(34,211,238,0.55)]"
              aria-hidden="true"
            >
              {countdown.toFixed(1)}
            </p>
            <div
              className="mx-auto mt-3 h-1.5 w-48 overflow-hidden rounded-full bg-cyan-950/70"
              role="progressbar"
              aria-label="Compte à rebours avant la plongée"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((countdown / countdownTotal) * 100)}
            >
              <div
                className="h-full rounded-full bg-cyan-400/80 transition-[width] duration-100"
                style={{ width: `${Math.min(100, (countdown / countdownTotal) * 100)}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="text-center">
            <p
              className={`font-mono text-7xl font-bold tabular-nums drop-shadow-[0_0_24px_rgba(34,211,238,0.45)] sm:text-8xl ${
                crashed ? "animate-pulse text-red-400 drop-shadow-[0_0_24px_rgba(248,113,113,0.6)]" : "breathe"
              }`}
              style={crashed ? undefined : { color: multiplierColor(multiplier) }}
            >
              {formatMultiplier(multiplier)}
            </p>
            <p
              className={`mt-2 font-mono text-xl tabular-nums ${
                crashed ? "text-red-300/90" : "text-cyan-200/90"
              }`}
            >
              {formatDepth(depthMeters)}
            </p>
            {crashed && (
              <p className="mt-4 inline-block rounded-lg border border-red-400/50 bg-red-950/70 px-4 py-1.5 text-lg font-bold uppercase tracking-[0.25em] text-red-300">
                Syncope !
              </p>
            )}
          </div>
        )}
      </div>

      {/* Étiquette de phase, coin supérieur gauche */}
      <div className="absolute left-3 top-3 rounded-full border border-white/10 bg-slate-950/60 px-3 py-1 text-xs font-medium uppercase tracking-wider text-cyan-100/80 backdrop-blur">
        {phase === "BETTING" && "Paris ouverts"}
        {phase === "DIVING" && "Descente en cours"}
        {phase === "CRASH" && "Syncope"}
        {phase === "RESULT" && "Fin du tour"}
      </div>

      {/* Annonce vocale pour lecteurs d'écran */}
      <div className="sr-only" role="status" aria-live="polite">
        {phase === "BETTING" && "Fenêtre de pari ouverte"}
        {phase === "DIVING" && "Plongée en cours"}
        {crashed &&
          `Syncope à ${formatMultiplier(snapshot.lastCrashPoint ?? 1)}`}
      </div>
    </div>
  );
}
