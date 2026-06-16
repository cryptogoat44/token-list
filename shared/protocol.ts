/**
 * Protocole temps réel client ↔ serveur (WebSocket) — SOURCE UNIQUE de vérité.
 *
 * Ce module est partagé tel quel par le serveur (`server/`) et par le client
 * web (`deep-diver/`). Il ne dépend NI de Node NI du DOM : uniquement des types
 * et une fonction de parsing pure, pour rester importable des deux côtés.
 *
 * Règle de sécurité (anti-triche) : l'état diffusé NE contient JAMAIS l'instant
 * de crash (`crashAt`) ni la graine serveur tant que le tour n'a pas crashé. Le
 * client reçoit seulement le multiplicateur courant poussé par le serveur ; il
 * ne peut donc pas prédire la syncope. La graine est révélée APRÈS le crash,
 * ce qui permet de vérifier l'équité (provably fair).
 */

/** Version du protocole de fil. À incrémenter sur tout changement non rétro-compatible. */
export const WIRE_PROTOCOL_VERSION = 1 as const;

/**
 * Phases d'un tour, pilotées par le serveur autoritaire.
 * (Le client mappe ensuite ces phases vers ses propres libellés d'affichage.)
 */
export type RoundPhase = "BETTING" | "RUNNING" | "CRASH" | "SETTLEMENT";

/** État PUBLIC d'un tour, sûr à diffuser (sans `crashAt` ni graine secrète). */
export interface PublicRoundState {
  roundId: number;
  phase: RoundPhase;
  /** Multiplicateur courant tronqué (autorité serveur). */
  multiplier: number;
  /** Fin de la fenêtre de pari (horodatage serveur, ms). */
  bettingEndsAt: number;
  /** Engagement (hash de la graine), publié AVANT le tour. */
  serverSeedHash: string;
  /** Graine révélée APRÈS le crash (null sinon). */
  serverSeedRevealed: string | null;
  /** Point de crash révélé APRÈS le crash (null sinon). */
  crashPoint: number | null;
  /** Agrégats d'ambiance (jamais les paris individuels des autres joueurs). */
  betCount: number;
  totalStakedCents: number;
  /** Horloge serveur au moment de l'instantané (synchro côté client). */
  serverTime: number;
}

/** Messages serveur → client. */
export type ServerMessage =
  | { t: "welcome"; playerId: string; serverTime: number; protocolVersion?: number }
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

/** Messages client → serveur (de simples INTENTIONS ; le serveur arbitre). */
export type ClientMessage =
  | { t: "place_bet"; betId: string; amountCents: number }
  | { t: "cashout"; betId: string }
  | { t: "ping" };

/**
 * Parse et VALIDE un message client. Renvoie `null` si le message est invalide
 * (jamais d'exception). Sert de garde-fou côté serveur : on ne fait jamais
 * confiance au contenu brut envoyé par le client.
 */
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
    if (!Number.isFinite(m.amountCents) || m.amountCents <= 0) return null;
    return { t: "place_bet", betId: m.betId.slice(0, 64), amountCents: Math.floor(m.amountCents) };
  }
  if (m.t === "cashout" && typeof m.betId === "string") {
    return { t: "cashout", betId: m.betId.slice(0, 64) };
  }
  if (m.t === "ping") return { t: "ping" };
  return null;
}

/** Sérialise un message client (helper symétrique pour le client web). */
export function encodeClientMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}
