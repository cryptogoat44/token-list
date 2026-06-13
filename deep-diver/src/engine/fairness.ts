/**
 * Système « provably fair » (équitable et vérifiable).
 *
 * Principe (commit-reveal) :
 *  1. AVANT le tour, le « serveur » (ici local) tire un serverSeed aléatoire et
 *     publie son empreinte SHA-256 : c'est l'engagement — le résultat est figé
 *     et ne peut plus être modifié sans invalider le hash.
 *  2. Le point de crash est dérivé de SHA-256(serverSeed:clientSeed:nonce).
 *     Le clientSeed appartient au joueur (modifiable), le nonce s'incrémente.
 *  3. APRÈS le crash, le serverSeed est révélé : chacun peut re-hacher et
 *     vérifier que le point de crash annoncé était bien celui engagé.
 *
 * Formule de référence (style Stake/BC.Game, sur 32 bits) :
 *     int        = 32 premiers bits du hash
 *     crashPoint = max(1.00, floor((2^32 / (int + 1)) · (1 − houseEdge) · 100) / 100)
 *
 * Propriétés mathématiques (int uniforme sur [0, 2^32 − 1]) :
 *  - P(crash ≥ m) = (1 − houseEdge) / m   → petits multiplicateurs fréquents,
 *    gros multiplicateurs exponentiellement rares ;
 *  - P(crash = 1.00) = 1 − (1 − houseEdge)/1.01 ≈ 3,96 % avec edge = 3 % :
 *    ~3-4 % des tours « syncopent » immédiatement en surface, ce qui
 *    matérialise l'avantage maison.
 *
 * Toutes les fonctions de calcul sont pures ; seul le hachage est asynchrone
 * (Web Crypto API, disponible dans les navigateurs et Node ≥ 18).
 */

const TWO_POW_32 = 2 ** 32;

/** Accès à Web Crypto (navigateur ou Node ≥ 18 via globalThis.crypto). */
function getCrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error(
      "Web Crypto API indisponible : servez l'application via HTTPS ou localhost.",
    );
  }
  return c;
}

/** SHA-256 d'une chaîne UTF-8, résultat en hexadécimal minuscule. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await getCrypto().subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Chaîne hexadécimale aléatoire de `byteLength` octets (CSPRNG). */
export function randomSeedHex(byteLength = 32): string {
  const buf = new Uint8Array(byteLength);
  getCrypto().getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Message haché pour un tour donné : "serverSeed:clientSeed:nonce". */
export function roundMessage(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): string {
  return `${serverSeed}:${clientSeed}:${nonce}`;
}

/** Entier 32 bits non signé dérivé des 8 premiers caractères hex du hash. */
export function uint32FromHashHex(hashHex: string): number {
  if (!/^[0-9a-f]{8,}$/i.test(hashHex)) {
    throw new Error("Hash hexadécimal invalide");
  }
  return Number.parseInt(hashHex.slice(0, 8), 16);
}

/**
 * Point de crash à partir d'un entier 32 bits uniforme — fonction pure,
 * cœur mathématique du jeu (voir l'en-tête du fichier pour la distribution).
 */
export function crashPointFromUint32(
  int32: number,
  houseEdge: number,
  maxMultiplier = Number.POSITIVE_INFINITY,
): number {
  if (!Number.isInteger(int32) || int32 < 0 || int32 >= TWO_POW_32) {
    throw new Error("int32 doit être un entier dans [0, 2^32 − 1]");
  }
  if (houseEdge < 0 || houseEdge >= 1) {
    throw new Error("houseEdge doit être dans [0, 1)");
  }
  const raw = (TWO_POW_32 / (int32 + 1)) * (1 - houseEdge);
  // Troncature à 2 décimales puis plancher à 1.00 (jamais en dessous).
  const crash = Math.max(1.0, Math.floor(raw * 100) / 100);
  // Plafond du multiplicateur, comme Aviator (max théorique 1 000 000x) : ne
  // change rien à la distribution sous le plafond, n'affecte que l'extrême
  // queue (~1 tour sur un million) et donc l'avantage maison de façon
  // totalement négligeable.
  return Math.min(crash, maxMultiplier);
}

/** Pipeline complet : seeds + nonce → hash → entier 32 bits → point de crash. */
export async function computeCrashPoint(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  houseEdge: number,
  maxMultiplier = Number.POSITIVE_INFINITY,
): Promise<{ hash: string; int32: number; crashPoint: number }> {
  const hash = await sha256Hex(roundMessage(serverSeed, clientSeed, nonce));
  const int32 = uint32FromHashHex(hash);
  return {
    hash,
    int32,
    crashPoint: crashPointFromUint32(int32, houseEdge, maxMultiplier),
  };
}

/** Engagement publié avant le tour : SHA-256 du serverSeed seul. */
export async function commitServerSeed(serverSeed: string): Promise<string> {
  return sha256Hex(serverSeed);
}

export interface VerificationInput {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  houseEdge: number;
  /** Hash d'engagement publié avant le tour (optionnel). */
  expectedServerSeedHash?: string;
  /** Point de crash annoncé par le jeu (optionnel). */
  expectedCrashPoint?: number;
  /** Plafond du multiplicateur appliqué par le jeu (défaut : aucun). */
  maxMultiplier?: number;
}

export interface VerificationResult {
  /** Hash SHA-256(serverSeed) recalculé. */
  serverSeedHash: string;
  /** Hash du message complet serverSeed:clientSeed:nonce. */
  roundHash: string;
  int32: number;
  crashPoint: number;
  /** true si le hash d'engagement fourni correspond (undefined si non fourni). */
  commitMatches?: boolean;
  /** true si le point de crash annoncé correspond (undefined si non fourni). */
  crashPointMatches?: boolean;
  /** Verdict global : tout ce qui était vérifiable correspond. */
  ok: boolean;
}

/**
 * Vérificateur indépendant : recalcule le point de crash à partir des seeds
 * et compare avec ce que le jeu a annoncé. C'est la fonction exposée dans
 * l'écran « Provably Fair ».
 */
export async function verifyRound(
  input: VerificationInput,
): Promise<VerificationResult> {
  const serverSeedHash = await commitServerSeed(input.serverSeed);
  const { hash, int32, crashPoint } = await computeCrashPoint(
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

/**
 * Fournisseur d'aléa injectable dans le moteur — permet de scénariser des
 * points de crash déterministes dans les tests sans toucher au moteur.
 */
export interface FairnessProvider {
  generateServerSeed(): string;
  commit(serverSeed: string): Promise<string>;
  crashPoint(
    serverSeed: string,
    clientSeed: string,
    nonce: number,
    houseEdge: number,
    maxMultiplier?: number,
  ): Promise<number>;
}

/** Implémentation réelle, utilisée par le jeu. */
export const realFairnessProvider: FairnessProvider = {
  generateServerSeed: () => randomSeedHex(32),
  commit: (serverSeed) => commitServerSeed(serverSeed),
  crashPoint: async (serverSeed, clientSeed, nonce, houseEdge, maxMultiplier) =>
    (
      await computeCrashPoint(
        serverSeed,
        clientSeed,
        nonce,
        houseEdge,
        maxMultiplier ?? Number.POSITIVE_INFINITY,
      )
    ).crashPoint,
};
