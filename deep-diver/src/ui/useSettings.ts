/**
 * Réglages d'accessibilité et de bien-être, persistés en localStorage.
 * Tout est optionnel et réversible ; rien n'est piégeux.
 */
import { useCallback, useEffect, useState } from "react";

export interface AppSettings {
  /** Réduire les animations (en plus de la préférence système). */
  reduceMotion: boolean;
  /** Ambiance sonore relaxante (nappe douce sous le souffle). */
  relaxAmbiance: boolean;
  /** Rappel de pause après N minutes de jeu continu (0 = désactivé). */
  sessionReminderMin: number;
}

const DEFAULTS: AppSettings = {
  reduceMotion: false,
  relaxAmbiance: false,
  sessionReminderMin: 30,
};

const KEY = "deepdiver.settings.v1";

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => load());

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Applique « réduire les animations » globalement (classe sur <html>).
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("reduce-motion", settings.reduceMotion);
  }, [settings.reduceMotion]);

  return { settings, update };
}
