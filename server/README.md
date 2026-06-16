# Deep Diver — RGS (Remote Game Server)

Serveur **autoritaire** et **certifiable** de Deep Diver. Le client n'est qu'un
afficheur ; **aucun** résultat, multiplicateur ou point de crash n'est décidé
côté client.

> État : **étape 1+2** du chantier RGS — le **cœur RNG + modèle mathématique
> audité** (`src/rng/`, `src/math/`). Les modules réseau (boucle de jeu,
> WebSocket, wallet, journal d'audit, conformité) arrivent aux étapes suivantes.

## Modules audités

| Module | Rôle |
| --- | --- |
| `src/math/crash.ts` | Distribution du point de crash `P(crash ≥ m) = (1 − edge)/m`, plafond. |
| `src/math/curve.ts` | Courbe `e^(k·t)` et son inverse (instant de crash). |
| `src/math/config.ts` | Config imposée par le serveur (RTP, edge, plafond, k). |
| `src/rng/provablyFair.ts` | CSPRNG (graine **secrète**), commit-reveal, dérivation du crash, vérificateur. |

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

## Commandes

```bash
cd server
npm install
npm test        # Vitest : distribution, courbe, commit-reveal, RTP empirique
npm run build   # tsc --noEmit
```
