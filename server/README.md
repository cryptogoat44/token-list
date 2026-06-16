# Deep Diver — RGS (Remote Game Server)

Serveur **autoritaire** et **certifiable** de Deep Diver. Le client n'est qu'un
afficheur ; **aucun** résultat, multiplicateur ou point de crash n'est décidé
côté client.

> État : **étapes 1 → 3c** du chantier RGS — cœur **RNG + modèle mathématique
> audité**, **machine à états du tour**, **passerelle WebSocket** temps réel et
> **protocole partagé** avec un client web **bi-mode**. Les modules wallet,
> journal d'audit et conformité arrivent aux étapes suivantes.

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
