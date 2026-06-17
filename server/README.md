# Deep Diver — RGS (Remote Game Server)

Serveur **autoritaire** et **certifiable** de Deep Diver. Le client n'est qu'un
afficheur ; **aucun** résultat, multiplicateur ou point de crash n'est décidé
côté client.

> État : **étapes 1 → 5** du chantier RGS — cœur **RNG + modèle mathématique
> audité**, **machine à états du tour**, **passerelle WebSocket** temps réel,
> **protocole partagé** (client web **bi-mode**), **API wallet seamless** et
> **journal d'audit infalsifiable** (chaîné par hash, rejouable). Wallet et audit
> sont **branchés** dans la boucle temps réel. La conformité / geo-gating arrive
> à l'étape suivante.

## Modules audités

| Module | Rôle |
| --- | --- |
| `src/math/crash.ts` | Distribution du point de crash `P(crash ≥ m) = (1 − edge)/m`, plafond. |
| `src/math/curve.ts` | Courbe `e^(k·t)` et son inverse (instant de crash). |
| `src/math/config.ts` | Config imposée par le serveur (RTP, edge, plafond, k). |
| `src/rng/provablyFair.ts` | CSPRNG (graine **secrète**), commit-reveal, dérivation du crash, vérificateur. |
| `src/game/round.ts` · `engine.ts` | Machine à états autoritaire (BETTING → RUNNING → CRASH → SETTLEMENT). |
| `src/realtime/gateway.ts` | Passerelle WebSocket : diffuse l'état public, reçoit les intentions (horodatage **serveur**). |
| `../shared/protocol.ts` | **Source unique** du protocole de fil, partagée avec le client web. |
| `src/wallet/types.ts` | Contrat **wallet seamless** (authenticate/getBalance/debit/credit/rollback). |
| `src/wallet/mockWalletAdapter.ts` | Implémentation mémoire idempotente (monnaie fictive, démo/tests). |
| `src/wallet/walletService.ts` | Traduit mise/encaissement/règlement → appels wallet (txId déterministes). |
| `src/audit/hashChain.ts` | Scellage + vérification de la chaîne de hash (SHA-256, sérialisation canonique). |
| `src/audit/{memory,file}AuditStore.ts` | Journal append-only (mémoire / fichier JSONL), même interface `AuditStore`. |
| `src/audit/auditLogger.ts` · `auditReplay.ts` | Écriture typée des événements · rejouabilité (équité + arithmétique). |

## RNG & équité

- La **graine serveur** est tirée par un CSPRNG (`node:crypto.randomBytes`) et
  reste **secrète** jusqu'à la révélation, après le tour.
- Avant le tour, le serveur publie `SHA-256(serverSeed)` (engagement) → il ne
  peut pas adapter le résultat aux mises, et le joueur ne peut pas prédire.
- `crashPoint = f(SHA-256(serverSeed : clientSeed : nonce))` — formule identique
  à la démo (vérificateur compatible), mais alimentée par une graine secrète.
  Les `clientSeed` des premiers parieurs peuvent être concaténés (façon Aviator)
  pour qu'aucune partie ne contrôle seule le résultat.
- Après le crash, `serverSeed` est **révélé** → `verifyRound()` (ou tout outil
  SHA-256 externe) recalcule et confirme.

## Modèle mathématique

`P(crash ≥ m) = (1 − houseEdge) / m`, avantage maison **3 %** (RTP **97 %**) par
défaut, **configurable côté serveur**, plafond **1 000 000x**. Le RTP est
constant à toute cible (`m · P(crash ≥ m) = 1 − edge`). Les tours instantanés
(`1.00x`, ≈ 3,96 %) matérialisent l'avantage maison.

## Wallet « seamless » (étape 4)

Modèle de l'industrie : l'**opérateur** licencié détient les fonds, le KYC et la
licence ; le RGS ne stocke **aucun** solde réel et **appelle** l'API wallet de
l'opérateur à chaque mouvement. Le studio fournit le contenu, l'opérateur porte
l'argent.

- **Contrat** (`WalletAdapter`) : `authenticate` · `getBalance` · `debit` ·
  `credit` · `rollback`. Un opérateur fournit son propre adaptateur ; le RGS est
  agnostique au PSP réel.
- **Idempotence** : chaque mouvement porte un `txId` **déterministe**
  (`r{roundId}:b{betId}:stake` / `:payout`) ; rejouer une opération ne double
  jamais l'effet (réseau peu fiable, rejeux). `rollback` compense par `txId`.
- **Sécurité argent** : centimes entiers, devise vérifiée à chaque appel, jamais
  de flottant. La démo utilise une devise **fictive** (`FUN`).

**Branché au temps réel** (passerelle) : à l'acceptation d'une mise →
`debitStake` (refus si fonds insuffisants ; **rollback** si le moteur refuse
après débit) ; sur l'événement `settled` du moteur → `WalletService.settle()`
crédite les gagnants (les perdants ne génèrent aucun appel, le débit ayant eu
lieu au pari). Chaque mouvement est journalisé dans l'audit.

## Journal d'audit infalsifiable (étape 5)

Registre **append-only** : chaque enregistrement est **chaîné par hash** au
précédent (`hash = SHA-256(seq, timestamp, type, payload, prevHash)`, payload
sérialisé de façon **canonique**). Retirer ou modifier une ligne casse la chaîne
et devient détectable. Événements journalisés : `round_open`, `bet_accepted` /
`bet_rejected`, `cashout`, `crash_revealed`, `settlement`, `wallet_movement`.

- **Stockage abstrait** (`AuditStore`) : `MemoryAuditStore` (défaut) et
  `FileAuditStore` (JSONL persistant) aujourd'hui ; un adaptateur **PostgreSQL**
  se branchera plus tard **sans rien réécrire**. Variable `AUDIT_FILE` pour le
  mode fichier.
- **Rejouabilité** (`replayAudit`) : re-dérive chaque tour depuis les graines via
  le **même vérificateur provably-fair** que le client, et recontrôle
  l'arithmétique des règlements. Un auditeur rejoue tout l'historique.
- **Endpoints HTTP** : `GET /audit/verify` (intégrité de la chaîne),
  `GET /audit/replay` (équité + règlements), `GET /audit` (fin du journal).

## Protocole partagé & client bi-mode

Le protocole de fil vit dans **`shared/protocol.ts`** (racine du dépôt) et est
importé tel quel par le serveur **et** par le client web — impossible de
diverger. Règle de sécurité : l'état diffusé n'inclut **jamais** `crashAt` ni la
graine serveur avant le crash (anti-prédiction) ; la graine est révélée après.

Le client `deep-diver/` est **bi-mode** :

- **démo locale** (par défaut, déployée publiquement) — moteur dans le
  navigateur, monnaie fictive ;
- **mode serveur** — afficheur mince branché sur ce RGS, activé en définissant
  `VITE_RGS_URL` au build :

```bash
# 1) lancer le serveur
cd server && npm install && npm run dev      # écoute sur :8080 (HTTP /health + WebSocket)

# 2) lancer le client en mode serveur
cd deep-diver
VITE_RGS_URL=ws://localhost:8080 npm run dev
```

Sans `VITE_RGS_URL`, la démo locale est servie à l'identique (aucune régression).

## Commandes

```bash
cd server
npm install
npm test        # Vitest : distribution, courbe, commit-reveal, RTP, intégration WebSocket
npm run build   # tsc --noEmit
npm run dev     # serveur de jeu (HTTP /health + WebSocket) sur :8080
```
