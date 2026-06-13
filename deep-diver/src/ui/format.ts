/** Helpers d'affichage (formats français). */

const creditFmt = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** 12345 centimes → "123,45" (sans unité). */
export function formatCredits(cents: number): string {
  return creditFmt.format(cents / 100);
}

/** 2.4567 → "2.45x" (le multiplicateur garde le point, convention du genre). */
export function formatMultiplier(m: number): string {
  return `${(Math.floor(m * 100) / 100).toFixed(2)}x`;
}

/** 37.4 → "-37 m" */
export function formatDepth(meters: number): string {
  return `-${Math.round(meters)} m`;
}

/** Tronque une seed pour l'affichage : "ab12…9f". */
export function shortSeed(seed: string, head = 8, tail = 4): string {
  if (seed.length <= head + tail + 1) return seed;
  return `${seed.slice(0, head)}…${seed.slice(-tail)}`;
}

/** Couleur d'un chip d'historique selon le multiplicateur. */
export function crashColorClass(x: number): string {
  if (x < 1.2) return "text-red-300 bg-red-500/15 ring-red-400/30";
  if (x < 2) return "text-sky-300 bg-sky-500/15 ring-sky-400/30";
  if (x < 10) return "text-emerald-300 bg-emerald-500/15 ring-emerald-400/30";
  if (x < 50) return "text-fuchsia-300 bg-fuchsia-500/15 ring-fuchsia-400/30";
  if (x < 100)
    return "text-amber-200 bg-amber-400/20 ring-amber-300/50 font-bold";
  // ≥ 100x : palier « légendaire », chip doré animé.
  return "text-yellow-100 bg-gradient-to-r from-amber-500/40 to-fuchsia-500/40 ring-yellow-200/70 font-bold shadow-[0_0_12px_-2px_rgba(251,191,36,0.8)]";
}

export interface DiveTier {
  /** Seuil minimal du palier. */
  min: number;
  label: string;
  emoji: string;
  /** true pour les paliers « événement » qui déclenchent une célébration. */
  celebrate: boolean;
}

const DIVE_TIERS: DiveTier[] = [
  { min: 100, label: "PLONGÉE LÉGENDAIRE", emoji: "👑", celebrate: true },
  { min: 50, label: "ZONE HADALE", emoji: "🌋", celebrate: true },
  { min: 20, label: "ABYSSES", emoji: "🐋", celebrate: true },
  { min: 10, label: "GRANDE PLONGÉE", emoji: "🔱", celebrate: true },
  { min: 5, label: "Belle descente", emoji: "🐠", celebrate: false },
  { min: 2, label: "Descente", emoji: "🫧", celebrate: false },
  { min: 1, label: "Surface", emoji: "🌊", celebrate: false },
];

/** Palier « spectacle » correspondant à un multiplicateur. */
export function diveTier(x: number): DiveTier {
  return DIVE_TIERS.find((t) => x >= t.min) ?? DIVE_TIERS[DIVE_TIERS.length - 1];
}
