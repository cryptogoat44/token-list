# Deep Diver — RGS (Remote Game Server)

Serveur **autoritaire** et **certifiable** de Deep Diver. Le client n'est qu'un
afficheur ; **aucun** résultat, multiplicateur ou point de crash n'est décidé
côté client.

> État : **étapes 1 → 8 complètes** — cœur **RNG + modèle mathématique audité**,
> **machine à états du tour**, **passerelle WebSocket** temps réel, **protocole
> partagé** (client web **bi-mode**), **API wallet seamless**, **journal d'audit
> infalsifiable** (chaîné par hash, rejouable), **conformité par juridiction /
> jeu responsable** (geo-gating, **France bloquée par défaut**), **banc de
> simulation** (rapport sur 1 M de tours) et **dossier de documentation**.

## Documentation

| Document | Contenu |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture serveur-autoritaire, composants, flux, déploiement. |
| [docs/GAME-RULES.md](docs/GAME-RULES.md) | Règles du jeu, phases, RTP, plafond, encaissement. |
| [docs/RNG.md](docs/RNG.md) | RNG provably-fair : graines, commit-reveal, dérivation. |
| [docs/VERIFY.md](docs/VERIFY.md) | Guide de vérification indépendante (exemple reproductible). |
| [docs/AUDIT.md](docs/AUDIT.md) | Schéma du journal d'audit, types d'événements, endpoints, rejouabilité. |
| [docs/math-model.md](docs/math-model.md) | Rapport du modèle mathématique (1 M de tours). |
| [docs/CERTIFICATION.md](docs/CERTIFICATION.md) | Cartographie vers les exigences de certification (GLI/iTech). |

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
| `src/compliance/jurisdictions.ts` · `complianceService.ts` | Geo-gating par juridiction/opérateur (**FR/US bloqués par défaut**). |
| `src/compliance/responsibleGaming.ts` | Garde-fous : auto-exclusion, plafonds de session, reality check. |
| `src/sim/simulate.ts` · `report.ts` · `run.ts` | Banc de simulation (N tours) + rapport Markdown du modèle mathématique. |

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

## Simulation & modèle mathématique (étape 7)

Banc de simulation qui tire N tours via la **même dérivation provably-fair** que
la production et agrège les statistiques de conformité (taux de crash instantané,
`P(crash ≥ m)` vs théorie, RTP implicite, quantiles, distribution).

```bash
npm run sim                              # 1 000 000 tours, graine déterministe → stdout
SIM_OUT=docs/math-model.md npm run sim   # écrit aussi le rapport Markdown
ROUNDS=5000000 npm run sim               # échantillon plus large
```

Rapport de référence (reproductible, graine `deep-diver-sim`) : **`docs/math-model.md`**.
Sur 1 M de tours, le RTP implicite reste à **~97 %** de 1,5x à 1000x et le crash
instantané ≈ **3,96 %** — conforme à `P(crash ≥ m) = (1 − edge)/m`.

## Conformité & jeu responsable (étape 6)

**Geo-gating par juridiction et opérateur** appliqué à la connexion (le pays
vient de l'edge/CDN, jamais du client) :

1. pays indéterminé → refus prudent ;
2. juridiction interdite (**France**, États-Unis par défaut) → refus, même si
   l'opérateur la liste ;
3. pays hors périmètre de l'opérateur (`defaultAllow=false`) → refus ;
4. sinon accès autorisé, avec le **plafond de mise** de la juridiction/opérateur.

Une connexion refusée reçoit une erreur, est **fermée**, et la décision est
journalisée (`access_denied`).

**Jeu responsable** (protections, jamais d'incitation, sans dark pattern) :
auto-exclusion (cool-off), plafond de mise et de **perte nette** par session,
et « reality check » périodique. Une mise bloquée est journalisée (`rg_block`).
La monnaie restant fictive, la démo n'impose pas de plafond ; un opérateur réel
branche ses limites réglementaires via la même interface.

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
