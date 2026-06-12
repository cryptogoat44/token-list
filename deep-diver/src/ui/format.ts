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
  return "text-fuchsia-300 bg-fuchsia-500/15 ring-fuchsia-400/30";
}
