# Deep Diver — Règles du jeu

Deep Diver est un jeu de type *crash* sur le thème de la plongée en apnée. Un
plongeur descend et un **multiplicateur** croît avec la profondeur ; le joueur
doit **remonter (encaisser)** avant la **syncope** (le crash). S'il encaisse à
temps, il gagne `mise × multiplicateur` ; sinon il perd sa mise.

> **Monnaie fictive.** La démo n'implique aucun argent réel. En production,
> l'opérateur licencié relie le jeu à son wallet (voir [ARCHITECTURE](ARCHITECTURE.md)).

## Cycle d'un tour

| Phase | Durée (défaut) | Description |
| --- | --- | --- |
| `BETTING` | 8 s | Fenêtre de mise (la mise débite le solde). |
| `RUNNING` | variable | Le multiplicateur croît ; encaissement possible. |
| `CRASH` | 1,6 s | Syncope : le multiplicateur se fige au point de crash. |
| `SETTLEMENT` | 3,5 s | Règlement : crédit des gagnants, écriture d'audit. |

Tous les joueurs partagent **le même tour** (lobby unique).

## Multiplicateur

Pendant `RUNNING`, le multiplicateur suit `m(t) = e^{k·t}` (`t` en secondes
depuis le début de `RUNNING`, `k = 0,14` par défaut). Il est **tronqué à 2
décimales** pour l'affichage et le calcul des gains. Le temps pour atteindre une
cible `m` est `t = ln(m) / k`.

## Point de crash, RTP et plafond

- **Avantage maison** : `edge = 3 %` → **RTP = 97 %**.
- **Distribution** : `P(crash ≥ m) = (1 − edge) / m`. Le RTP est **constant** à
  toute cible d'encaissement : `m · P(crash ≥ m) = 1 − edge = 0,97`.
- **Plafond** : `1 000 000x` (comme les références du genre).
- **Crash instantané** (`1.00x`) : ≈ **3,96 %** des tours — c'est la
  matérialisation de l'avantage maison (voir [math-model](math-model.md)).

Le point de crash est **dérivé d'une graine secrète** et **figé dès la création
du tour** (provably fair, voir [RNG](RNG.md)). Il n'est **jamais** ajusté en
fonction des mises.

## Mise & encaissement

- Mise minimale : 1 crédit (100 centimes). Pas de plafond imposé par le jeu (la
  juridiction/opérateur peut en fixer un, voir conformité).
- Gain à l'encaissement : `round(mise × multiplicateur_tronqué)`, en centimes.
- **L'instant d'encaissement qui fait foi est l'horodatage SERVEUR** à la
  réception de l'intention. Un encaissement après l'instant de crash est refusé.

## Équité

Avant chaque tour, le serveur publie `SHA-256(serverSeed)` (engagement). Après le
crash, il révèle `serverSeed` : quiconque peut recalculer le point de crash et
vérifier qu'il n'a pas été truqué (voir [VERIFY](VERIFY.md)).
