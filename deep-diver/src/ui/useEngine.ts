/**
 * Pont moteur ↔ React : crée le GameEngine une seule fois, le fait avancer à
 * chaque frame (requestAnimationFrame) et expose un instantané réactif.
 * Persiste solde, clientSeed et préférence sonore dans localStorage.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CONFIG } from "../engine/config";
import { GameEngine } from "../engine/engine";
import { randomSeedHex } from "../engine/fairness";
import { SharedWorld } from "../engine/sharedWorld";
import type { EngineEvent, EngineSnapshot } from "../engine/types";

const STORAGE = {
  balance: "deepdiver.balanceCents",
  clientSeed: "deepdiver.clientSeed",
  muted: "deepdiver.muted",
} as const;

function readStoredBalance(): number | undefined {
  try {
    const raw = localStorage.getItem(STORAGE.balance);
    if (raw === null) return undefined;
    const value = Number.parseInt(raw, 10);
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function readStoredClientSeed(): string {
  try {
    const raw = localStorage.getItem(STORAGE.clientSeed);
    if (raw && raw.length > 0 && raw.length <= 64) return raw;
  } catch {
    /* stockage indisponible */
  }
  const seed = randomSeedHex(8);
  try {
    localStorage.setItem(STORAGE.clientSeed, seed);
  } catch {
    /* ignore */
  }
  return seed;
}

export function readStoredMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE.muted) === "1";
  } catch {
    return false;
  }
}

export function storeMuted(muted: boolean): void {
  try {
    localStorage.setItem(STORAGE.muted, muted ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function storeClientSeed(seed: string): void {
  try {
    localStorage.setItem(STORAGE.clientSeed, seed);
  } catch {
    /* ignore */
  }
}

export interface UseEngineResult {
  engine: GameEngine;
  snapshot: EngineSnapshot;
  /** Abonne un écouteur d'événements moteur (sons, toasts, particules…). */
  onEvents: (listener: (events: EngineEvent[]) => void) => () => void;
  /** Horloge utilisée par le moteur (murale en mode lobby partagé). */
  clock: () => number;
}

export function useEngine(): UseEngineResult {
  // Mode « lobby partagé » : tous les joueurs partagent la même timeline,
  // calculée depuis l'horloge murale (UTC) et une graine publique. Le moteur
  // est donc piloté par Date.now() (comparable entre machines), pas par
  // performance.now() (relatif au chargement de la page).
  const { engine, world, clock } = useMemo(() => {
    const world = new SharedWorld(DEFAULT_CONFIG);
    void world.prime(Date.now()); // amorce le précalcul pour éviter le flash « sync »
    const engine = new GameEngine({
      sharedWorld: world,
      clientSeed: readStoredClientSeed(),
      initialBalanceCents: readStoredBalance(),
    });
    return { engine, world, clock: () => Date.now() };
  }, []);
  void world;

  const [snapshot, setSnapshot] = useState<EngineSnapshot>(() =>
    engine.getSnapshot(),
  );
  const eventListeners = useRef(new Set<(events: EngineEvent[]) => void>());
  const lastSavedBalance = useRef<number>(-1);

  useEffect(() => {
    const unsubscribe = engine.subscribe((snap, events) => {
      setSnapshot(snap);
      if (events.length > 0) {
        eventListeners.current.forEach((l) => l(events));
      }
      if (snap.balanceCents !== lastSavedBalance.current) {
        lastSavedBalance.current = snap.balanceCents;
        try {
          localStorage.setItem(STORAGE.balance, String(snap.balanceCents));
        } catch {
          /* ignore */
        }
      }
    });

    let raf = 0;
    const loop = () => {
      engine.tick(clock());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, [engine, clock]);

  const onEvents = useMemo(
    () => (listener: (events: EngineEvent[]) => void) => {
      eventListeners.current.add(listener);
      return () => {
        eventListeners.current.delete(listener);
      };
    },
    [],
  );

  return { engine, snapshot, onEvents, clock };
}
