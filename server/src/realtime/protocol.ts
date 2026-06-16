/**
 * Protocole temps réel client ↔ serveur (WebSocket).
 *
 * Règle de sécurité : l'état diffusé NE contient JAMAIS l'instant de crash
 * (`crashAt`) ni la graine serveur tant que le tour n'a pas crashé. Le client
 * reçoit seulement le multiplicateur courant (poussé par le serveur) et ne
 * peut donc pas prédire la syncope. La graine est révélée après le crash.
 *
 * Sera déplacé dans `shared/` à l'étape 3c (consommé par le client).
 */
import type { Phase } from "../game/types";

/** État PUBLIC d'un tour, sûr à diffuser (sans crashAt ni graine secrète). */
export interface PublicRoundState {
  roundId: number;
  phase: Phase;
  /** Multiplicateur courant tronqué (autorité serveur). */
  multiplier: number;
  /** Fin de la fenêtre de pari (public). */
  bettingEndsAt: number;
  /** Engagement (hash de la graine), publié avant le tour. */
  serverSeedHash: string;
  /** Graine révélée APRÈS le crash (null sinon). */
  serverSeedRevealed: string | null;
  /** Point de crash révélé APRÈS le crash (null sinon). */
  crashPoint: number | null;
  /** Agrégats d'ambiance (pas les paris individuels des autres). */
  betCount: number;
  totalStakedCents: number;
  /** Horloge serveur (synchro côté client). */
  serverTime: number;
}

/** Messages serveur → client. */
export type ServerMessage =
  | { t: "welcome"; playerId: string; serverTime: number }
  | { t: "state"; state: PublicRoundState }
  | { t: "round_created"; roundId: number; serverSeedHash: string; bettingEndsAt: number; serverTime: number }
  | {
      t: "crashed";
      roundId: number;
      crashPoint: number;
      serverSeed: string;
      serverSeedHash: string;
      clientSeed: string;
      nonce: number;
    }
  | { t: "bet_ack"; betId: string; ok: boolean; reason?: string }
  | { t: "cashout_ack"; betId: string; ok: boolean; multiplier?: number; payoutCents?: number; reason?: string }
  | { t: "error"; message: string };

/** Messages client → serveur (de simples INTENTIONS). */
export type ClientMessage =
  | { t: "place_bet"; betId: string; amountCents: number }
  | { t: "cashout"; betId: string }
  | { t: "ping" };

export function parseClientMessage(raw: string): ClientMessage | null {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const m = o as Record<string, unknown>;
  if (m.t === "place_bet" && typeof m.betId === "string" && typeof m.amountCents === "number") {
    return { t: "place_bet", betId: m.betId.slice(0, 64), amountCents: Math.floor(m.amountCents) };
  }
  if (m.t === "cashout" && typeof m.betId === "string") {
    return { t: "cashout", betId: m.betId.slice(0, 64) };
  }
  if (m.t === "ping") return { t: "ping" };
  return null;
}
