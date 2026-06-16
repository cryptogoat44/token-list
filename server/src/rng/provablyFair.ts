/**
 * RNG provably-fair SERVEUR — commit-reveal à graine secrète.
 *
 * Différence clé avec la démo client : la graine serveur est tirée par un
 * CSPRNG (`node:crypto.randomBytes`) et reste **secrète** jusqu'à la révélation,
 * APRÈS le tour. Le serveur publie seulement `SHA-256(serverSeed)` avant le
 * tour (engagement) : il ne peut donc pas adapter le résultat aux mises, et le
 * joueur ne peut pas prédire le tour. Après le crash, la graine est révélée et
 * quiconque peut recalculer.
 *
 * Le point de crash est dérivé exactement comme côté client (continuité du
 * vérificateur) :
 *     hash       = SHA-256(serverSeed : clientSeed : nonce)
 *     int        = 32 premiers bits du hash
 *     crashPoint = crashPointFromUint32(int, houseEdge, maxMultiplier)
 *
 * Les clientSeed des joueurs (style Aviator : seeds des premiers parieurs)
 * peuvent être concaténés dans `clientSeed` pour que personne — ni l'opérateur,
 * ni un joueur — ne contrôle seul le résultat.
 *
 * Fonctions pures (hors génération de graine) ; aucune dépendance réseau/UI.
 */
import { createHash, randomBytes } from "node:crypto";
import { crashPointFromUint32, uint32FromHashHex } from "../math/crash";

/** SHA-256 d'une chaîne UTF-8, en hexadécimal minuscule. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Graine serveur secrète : `bytes` octets aléatoires (CSPRNG), en hex. */
export function generateServerSeed(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** Engagement publié AVANT le tour : SHA-256(serverSeed). */
export function commitServerSeed(serverSeed: string): string {
  return sha256Hex(serverSeed);
}

/** Message haché d'un tour : "serverSeed:clientSeed:nonce". */
export function roundMessage(serverSeed: string, clientSeed: string, nonce: number): string {
  return `${serverSeed}:${clientSeed}:${nonce}`;
}

export interface CrashDerivation {
  hash: string;
  int32: number;
  crashPoint: number;
}

/** Dérive le point de crash d'un tour (déterministe). */
export function deriveCrashPoint(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  houseEdge: number,
  maxMultiplier: number = Number.POSITIVE_INFINITY,
): CrashDerivation {
  const hash = sha256Hex(roundMessage(serverSeed, clientSeed, nonce));
  const int32 = uint32FromHashHex(hash);
  return { hash, int32, crashPoint: crashPointFromUint32(int32, houseEdge, maxMultiplier) };
}

export interface VerificationInput {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  houseEdge: number;
  maxMultiplier?: number;
  /** Engagement publié avant le tour (optionnel). */
  expectedServerSeedHash?: string;
  /** Point de crash annoncé (optionnel). */
  expectedCrashPoint?: number;
}

export interface VerificationResult {
  serverSeedHash: string;
  roundHash: string;
  int32: number;
  crashPoint: number;
  commitMatches?: boolean;
  crashPointMatches?: boolean;
  ok: boolean;
}

/** Vérificateur indépendant : recalcule l'engagement et le point de crash. */
export function verifyRound(input: VerificationInput): VerificationResult {
  const serverSeedHash = commitServerSeed(input.serverSeed);
  const { hash, int32, crashPoint } = deriveCrashPoint(
    input.serverSeed,
    input.clientSeed,
    input.nonce,
    input.houseEdge,
    input.maxMultiplier ?? Number.POSITIVE_INFINITY,
  );
  const commitMatches =
    input.expectedServerSeedHash === undefined
      ? undefined
      : serverSeedHash === input.expectedServerSeedHash.trim().toLowerCase();
  const crashPointMatches =
    input.expectedCrashPoint === undefined
      ? undefined
      : Math.abs(crashPoint - input.expectedCrashPoint) < 1e-9;
  return {
    serverSeedHash,
    roundHash: hash,
    int32,
    crashPoint,
    commitMatches,
    crashPointMatches,
    ok: commitMatches !== false && crashPointMatches !== false,
  };
}
