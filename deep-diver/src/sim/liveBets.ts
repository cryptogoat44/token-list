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

function maskName(raw: string): string {
  if (raw.length <= 4) return raw[0] + "***";
  return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
}

function randomName(): string {
  const a = FIRST_PARTS[Math.floor(Math.random() * FIRST_PARTS.length)];
  const b = LAST_PARTS[Math.floor(Math.random() * LAST_PARTS.length)];
  return maskName(a + b);
}

/** Mises plausibles : beaucoup de petites, quelques grosses. */
function randomBetCents(): number {
  const r = Math.random();
  if (r < 0.5) return (Math.floor(Math.random() * 9) + 1) * 100; // 1–9
  if (r < 0.85) return (Math.floor(Math.random() * 19) + 2) * 500; // 10–100
  return (Math.floor(Math.random() * 8) + 2) * 5_000; // 100–450
}

/**
 * Objectif de remontée : distribution proche de celle des vrais joueurs —
 * inverse d'un tirage uniforme (beaucoup de 1.1–2x, rares très gros), avec
 * ~12 % de téméraires qui ne remontent jamais.
 */
function randomTarget(): number {
  if (Math.random() < 0.12) return Number.POSITIVE_INFINITY;
  const u = Math.random();
  const target = 1.01 + 0.95 / Math.max(0.02, u) - 0.95;
  return Math.min(75, Math.floor(target * 100) / 100);
}

/** Génère la salle d'un nouveau tour (entre 14 et 28 plongeurs). */
export function generateRoundBettors(): FakeBettor[] {
  const count = 14 + Math.floor(Math.random() * 15);
  return Array.from({ length: count }, () => ({
    id: nextId++,
    name: randomName(),
    betCents: randomBetCents(),
    target: randomTarget(),
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

/** Compteur « joueurs en ligne » qui dérive doucement, pour l'ambiance. */
export function driftOnlineCount(previous: number): number {
  const next = previous + Math.round((Math.random() - 0.48) * 9);
  return Math.max(312, Math.min(987, next));
}

export function initialOnlineCount(): number {
  return 450 + Math.floor(Math.random() * 200);
}
