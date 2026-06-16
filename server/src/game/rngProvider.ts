/**
 * Fournisseur d'aléa pour le moteur de jeu — INJECTABLE.
 *
 * En production, c'est le CSPRNG provably-fair (`rng/`). Dans les tests, on
 * injecte un fournisseur scripté pour des tours déterministes, sans toucher au
 * moteur. Le moteur ne génère donc jamais l'aléa lui-même.
 */
import {
  commitServerSeed,
  deriveCrashPoint,
  generateServerSeed,
} from "../rng/provablyFair";

export interface RngProvider {
  /** Tire une graine serveur SECRÈTE (CSPRNG). */
  newServerSeed(): string;
  /** Engagement publié avant le tour. */
  commit(serverSeed: string): string;
  /** Point de crash dérivé (déterministe). */
  crashPoint(
    serverSeed: string,
    clientSeed: string,
    nonce: number,
    houseEdge: number,
    maxMultiplier: number,
  ): number;
}

export const realRng: RngProvider = {
  newServerSeed: () => generateServerSeed(32),
  commit: (serverSeed) => commitServerSeed(serverSeed),
  crashPoint: (serverSeed, clientSeed, nonce, houseEdge, maxMultiplier) =>
    deriveCrashPoint(serverSeed, clientSeed, nonce, houseEdge, maxMultiplier).crashPoint,
};
