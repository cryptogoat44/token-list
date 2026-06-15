/**
 * Pont profil persistant ↔ React. Écoute la fin de chaque tour du moteur et met
 * à jour records, succès, carnet de plongée et cosmétiques (localStorage).
 * Toute la logique de calcul est pure (engine/profile.ts) ; ici on ne fait
 * qu'orchestrer la persistance et exposer des actions à l'UI.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameEngine } from "../engine/engine";
import {
  applyRound,
  markVerified as markVerifiedPure,
  reviveProfile,
  selectCosmetic as selectCosmeticPure,
  type PlayerProfile,
  type RoundOutcome,
} from "../engine/profile";
import type { CosmeticSlot } from "../engine/cosmetics";
import { DEFAULT_PRESETS, addCustomPreset, type CashoutPreset } from "../engine/presets";

const KEY_PROFILE = "deepdiver.profile.v1";
const KEY_PRESETS = "deepdiver.presets.v1";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible */
  }
}

export interface ProfileNotice {
  newAchievements: string[];
  newRecord: boolean;
}

export interface UseProfileResult {
  profile: PlayerProfile;
  presets: CashoutPreset[];
  setDiverName(name: string): void;
  pickCosmetic(slot: CosmeticSlot, id: string): void;
  savePreset(name: string, multiplier: number): void;
  /** À appeler quand le joueur vérifie un tour (débloque un succès). */
  notifyVerified(): void;
  /** Abonne un écouteur de nouveautés (succès/record) pour toasts & célébrations. */
  onProfileEvents(listener: (n: ProfileNotice) => void): () => void;
}

export function useProfile(engine: GameEngine): UseProfileResult {
  const [profile, setProfile] = useState<PlayerProfile>(() =>
    reviveProfile(load<unknown>(KEY_PROFILE, null)),
  );
  const [presets, setPresets] = useState<CashoutPreset[]>(() =>
    load<CashoutPreset[]>(KEY_PRESETS, DEFAULT_PRESETS),
  );
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const listeners = useRef(new Set<(n: ProfileNotice) => void>());

  const commit = useCallback((next: PlayerProfile, notice?: ProfileNotice) => {
    profileRef.current = next;
    setProfile(next);
    save(KEY_PROFILE, next);
    if (notice && (notice.newAchievements.length > 0 || notice.newRecord)) {
      listeners.current.forEach((l) => l(notice));
    }
  }, []);

  // Met à jour le profil à la fin de chaque tour joué.
  useEffect(() => {
    return engine.subscribe((snap, events) => {
      if (!events.some((e) => e.type === "crashed")) return;
      const crashEvt = events.find((e) => e.type === "crashed");
      const crashPoint = crashEvt && crashEvt.type === "crashed" ? crashEvt.crashPoint : 1;
      const betSlots = snap.slots.filter(
        (s) => s.status === "cashed" || s.status === "lost",
      );
      if (betSlots.length === 0) return; // tour seulement regardé, pas joué
      const cashedSlots = snap.slots.filter((s) => s.status === "cashed");
      const cashed = cashedSlots.length > 0;
      const outcome: RoundOutcome = {
        cashed,
        cashoutMultiplier: cashed
          ? Math.max(...cashedSlots.map((s) => s.cashedOutAt ?? 0))
          : null,
        crashPoint,
        winCents: cashed ? Math.max(...cashedSlots.map((s) => s.winCents ?? 0)) : 0,
        netCents: betSlots.reduce(
          (acc, s) =>
            acc + (s.status === "cashed" ? (s.winCents ?? 0) : 0) - (s.betCents ?? 0),
          0,
        ),
        date: new Date().toISOString(),
      };
      const res = applyRound(profileRef.current, outcome);
      commit(res.profile, { newAchievements: res.newAchievements, newRecord: res.newRecord });
    });
  }, [engine, commit]);

  const setDiverName = useCallback(
    (name: string) => commit({ ...profileRef.current, diverName: name.slice(0, 24) }),
    [commit],
  );
  const pickCosmetic = useCallback(
    (slot: CosmeticSlot, id: string) =>
      commit(selectCosmeticPure(profileRef.current, slot, id)),
    [commit],
  );
  const savePreset = useCallback((name: string, multiplier: number) => {
    setPresets((prev) => {
      const next = addCustomPreset(prev, name, multiplier);
      save(KEY_PRESETS, next);
      return next;
    });
  }, []);
  const notifyVerified = useCallback(() => {
    const res = markVerifiedPure(profileRef.current);
    commit(res.profile, { newAchievements: res.newAchievements, newRecord: false });
  }, [commit]);

  const onProfileEvents = useMemo(
    () => (listener: (n: ProfileNotice) => void) => {
      listeners.current.add(listener);
      return () => {
        listeners.current.delete(listener);
      };
    },
    [],
  );

  return {
    profile,
    presets,
    setDiverName,
    pickCosmetic,
    savePreset,
    notifyVerified,
    onProfileEvents,
  };
}
