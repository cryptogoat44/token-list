/**
 * Faux flux de joueurs « en direct » — PUREMENT DÉCORATIF.
 *
 * Tout est généré localement : pseudos, mises et objectifs de remontée sont
 * tirés au hasard à chaque tour pour donner l'ambiance d'une salle de jeu.
 * Aucun de ces « plongeurs » n'influence le moteur ni le point de crash.
 */

export interface FakeBettor {
  id: number;
  /** Pseudo partiellement masqué, ex. "Ab***na". */
  name: string;
  betCents: number;
  /**
   * Multiplicateur auquel ce PNJ a prévu de remonter.
   * +∞ pour les téméraires qui ne remontent jamais (et syncopent toujours).
   */
  target: number;
}

export type FakeBettorStatus = "diving" | "cashed" | "lost";

export interface FakeBettorView extends FakeBettor {
  status: FakeBettorStatus;
  /** Gain affiché si remonté, en centimes. */
  winCents: number | null;
}

const FIRST_PARTS = [
  "Abys", "Coral", "Nemo", "Manta", "Pelagic", "Azur", "Triton", "Sirena",
  "Kraken", "Marlin", "Otarie", "Murene", "Plankton", "Naiade", "Brise",
  "Corail", "Lagon", "Tempete", "Harpon", "Vague", "Ecume", "Recif",
  "Orque", "Beluga", "Narval", "Atoll", "Cachalot", "Mistral", "Soneva",
  "Calypso", "Maelstrom", "Poseidon", "Nautile", "Sardine", "Espadon",
];
const LAST_PARTS = [
  "77", "_pro", "King", "Diver", "Fr", "92", "Apnee", "Bleu", "Deep",
  "X", "2000", "Zen", "Wave", "Sub", "Lux", "Mar", "Run", "Flow", "One",
];

let nextId = 1;

/** PRNG déterministe (mulberry32) pour une salle reproductible par tour. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function maskName(raw: string): string {
  if (raw.length <= 4) return raw[0] + "***";
  return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
}

function pickName(rng: () => number): string {
  const a = FIRST_PARTS[Math.floor(rng() * FIRST_PARTS.length)];
  const b = LAST_PARTS[Math.floor(rng() * LAST_PARTS.length)];
  return maskName(a + b);
}

/** Mises plausibles : beaucoup de petites, quelques grosses. */
function pickBetCents(rng: () => number): number {
  const r = rng();
  if (r < 0.5) return (Math.floor(rng() * 9) + 1) * 100; // 1–9
  if (r < 0.85) return (Math.floor(rng() * 19) + 2) * 500; // 10–100
  return (Math.floor(rng() * 8) + 2) * 5_000; // 100–450
}

/**
 * Objectif de remontée : distribution proche de celle des vrais joueurs —
 * inverse d'un tirage uniforme (beaucoup de 1.1–2x, rares très gros), avec
 * ~12 % de téméraires qui ne remontent jamais.
 */
function pickTarget(rng: () => number): number {
  if (rng() < 0.12) return Number.POSITIVE_INFINITY;
  const u = rng();
  const target = 1.01 + 0.95 / Math.max(0.02, u) - 0.95;
  return Math.min(75, Math.floor(target * 100) / 100);
}

/**
 * Génère la salle d'un tour (14 à 28 plongeurs). Si `seed` est fourni (ex.
 * l'identifiant du tour partagé), la salle est DÉTERMINISTE : tous les joueurs
 * du lobby voient exactement les mêmes parieurs.
 */
export function generateRoundBettors(seed?: number): FakeBettor[] {
  const seeded = seed !== undefined;
  const rng = seeded ? mulberry32(seed) : Math.random;
  const count = 14 + Math.floor(rng() * 15);
  return Array.from({ length: count }, (_, i) => ({
    id: seeded ? seed * 1000 + i : nextId++,
    name: pickName(rng),
    betCents: pickBetCents(rng),
    target: pickTarget(rng),
  }));
}

/**
 * Statut d'affichage des PNJ pour l'état courant du tour.
 * `multiplier` est le multiplicateur courant (ou final), `crashed` indique
 * si la syncope a déjà eu lieu.
 */
export function viewBettors(
  bettors: FakeBettor[],
  multiplier: number,
  crashed: boolean,
): FakeBettorView[] {
  return bettors.map((b) => {
    if (b.target <= multiplier) {
      return {
        ...b,
        status: "cashed",
        winCents: Math.round(b.betCents * b.target),
      };
    }
    return { ...b, status: crashed ? "lost" : "diving", winCents: null };
  });
}

/** Nombre de « joueurs en ligne » déterministe pour un tour (salle partagée). */
export function onlineCountForRound(roundId: number): number {
  const rng = mulberry32((roundId ^ 0x9e3779b9) >>> 0);
  return 380 + Math.floor(rng() * 520); // 380–900, stable pour le tour
}
