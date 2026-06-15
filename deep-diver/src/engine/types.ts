/**
 * Types partagés du moteur de jeu (aucune dépendance au DOM).
 */

/** Les quatre phases du cycle d'un tour. */
export type Phase = "BETTING" | "DIVING" | "CRASH" | "RESULT";

/** Statut d'un panier de mise au cours d'un tour. */
export type SlotStatus =
  | "idle" //     aucun pari sur ce tour
  | "placed" //   mise validée, en attente du début de la plongée
  | "playing" //  plongée en cours, mise engagée
  | "cashed" //   remonté à temps : gain encaissé
  | "lost"; //    syncope avant la remontée : mise perdue

export interface AutoBetConfig {
  /** Mise rejouée à chaque tour, en centimes. */
  betCents: number;
  /** Nombre de tours restants à jouer (décrémenté à chaque mise posée). */
  roundsRemaining: number;
  /** Stop si le solde passe sous ce seuil (centimes), null = désactivé. */
  stopIfBalanceBelowCents: number | null;
  /** Stop dès qu'un tour se solde par une perte sur ce panier. */
  stopOnLoss: boolean;
}

/** État public d'un panier de mise (il y en a deux, indépendants). */
export interface SlotState {
  id: 0 | 1;
  status: SlotStatus;
  /** Mise engagée sur le tour courant, en centimes (null si aucune). */
  betCents: number | null;
  /** Multiplicateur cible d'auto cash out (null = désactivé). */
  autoCashout: number | null;
  /** Multiplicateur auquel le panier a encaissé (si status === "cashed"). */
  cashedOutAt: number | null;
  /** Gain crédité en centimes (si status === "cashed"). */
  winCents: number | null;
  /** Pari automatique en cours (null = inactif). */
  autoBet: AutoBetConfig | null;
}

/** Informations « provably fair » publiées pour le tour courant. */
export interface RoundPublicInfo {
  /** Identifiant croissant du tour (côté session). */
  roundId: number;
  /** Nonce utilisé dans le hash (réinitialisé quand le clientSeed change). */
  nonce: number;
  /** Seed choisi/éditable par le joueur. */
  clientSeed: string;
  /** Engagement : SHA-256(serverSeed), publié AVANT le tour. */
  serverSeedHash: string | null;
  /** Seed serveur révélé APRÈS le crash (null tant que le tour est en cours). */
  serverSeedRevealed: string | null;
  /** Point de crash, révélé seulement une fois le tour terminé. */
  crashPoint: number | null;
}

/** Entrée d'historique d'un tour terminé (tout est révélé). */
export interface RoundHistoryEntry {
  roundId: number;
  nonce: number;
  clientSeed: string;
  serverSeed: string;
  serverSeedHash: string;
  crashPoint: number;
  /** Horodatage (ms epoch logique du moteur) de fin de tour. */
  endedAt: number;
}

/** Statistiques de session du joueur. */
export interface SessionStats {
  /** Tours où le joueur avait au moins une mise engagée. */
  roundsPlayed: number;
  /** Nombre total de mises posées (les deux paniers comptent séparément). */
  betsPlaced: number;
  /** Total misé / total encaissé, en centimes. */
  totalWageredCents: number;
  totalReturnedCents: number;
  /** Gain net de la session (peut être négatif), en centimes. */
  netCents: number;
  /** Plus gros multiplicateur encaissé. */
  bestCashoutX: number;
  /** Plus gros gain encaissé sur une mise, en centimes. */
  bestWinCents: number;
  /** Plus longues séries de tours gagnants / perdants. */
  longestWinStreak: number;
  longestLossStreak: number;
  /** Série en cours : positif = tours gagnants d'affilée, négatif = perdants. */
  currentStreak: number;
}

/** Événements émis par le moteur (pour les sons, toasts, particules…). */
export type EngineEvent =
  | { type: "phaseChanged"; phase: Phase }
  | { type: "betPlaced"; slot: 0 | 1; betCents: number }
  | { type: "betCancelled"; slot: 0 | 1; betCents: number }
  | {
      type: "cashedOut";
      slot: 0 | 1;
      multiplier: number;
      winCents: number;
      auto: boolean;
    }
  | { type: "betLost"; slot: 0 | 1; betCents: number }
  | { type: "crashed"; crashPoint: number }
  | { type: "autoBetStopped"; slot: 0 | 1; reason: "finished" | "balance" | "stopCondition" | "loss" | "manual" }
  | { type: "walletReset" }
  | { type: "creditsToppedUp"; amountCents: number; balanceCents: number };

/** Instantané complet de l'état public du moteur, recalculé à chaque tick. */
export interface EngineSnapshot {
  phase: Phase;
  /** Mode lobby partagé : true tant que la timeline n'est pas synchronisée. */
  syncing: boolean;
  /** Horloge du dernier tick (ms). */
  now: number;
  /** Fin de la fenêtre de pari (ms), pertinent en phase BETTING. */
  bettingEndsAt: number;
  /** Multiplicateur affiché, tronqué à 2 décimales (1.00 hors plongée). */
  multiplier: number;
  /** Multiplicateur continu (non tronqué) pour les animations. */
  rawMultiplier: number;
  /** Profondeur actuelle en mètres (0 hors plongée). */
  depthMeters: number;
  /** Temps écoulé depuis le début de la plongée (ms). */
  diveElapsedMs: number;
  /** Solde du joueur en centimes. */
  balanceCents: number;
  slots: [SlotState, SlotState];
  round: RoundPublicInfo;
  /** Multiplicateur final du dernier tour terminé (null avant le 1er crash). */
  lastCrashPoint: number | null;
  /** Historique, du plus récent au plus ancien. */
  history: RoundHistoryEntry[];
  stats: SessionStats;
}
