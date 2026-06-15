# Équité « façon Aviator » & architecture prête pour un serveur

Ce document décrit comment Deep Diver atteindra **exactement le modèle d'équité
d'Aviator (Spribe)** le jour où un **backend** sera ajouté, et comment le code
actuel est déjà organisé pour que ce serveur soit un simple branchement.

> Statut actuel : **pas de serveur**. Le jeu tourne 100 % côté navigateur. On
> construira le serveur _ensuite_ ; ce fichier fige la cible et le contrat.

## Le modèle Aviator (cible)

- **Un seul tour partagé** pour tous les joueurs (un seul plongeur, un seul
  point de crash par tour) — déjà le cas via le « lobby partagé ».
- Point de crash dérivé d'une **combinaison** :
  `hash( serverSeed + clientSeed₁ + clientSeed₂ + clientSeed₃ )` (Aviator
  utilise SHA-512 et les graines des **3 premiers parieurs** du tour).
- **Commit-reveal** : le `SHA-256(serverSeed)` est publié **avant** le tour
  (engagement) ; le `serverSeed` est **révélé après** le crash → chacun
  recalcule et vérifie.
- Avantage : aucune partie seule (opérateur **ni** joueur) ne contrôle le
  résultat, et rien ne peut être trafiqué après l'engagement.

## Pourquoi un serveur est nécessaire pour l'équité « réelle »

Sans backend, **aucun secret n'est possible** : la graine est livrée au
navigateur, donc un joueur averti pourrait pré-calculer les tours. C'est
**acceptable en argent fictif** (transparent), mais **rédhibitoire en argent
réel**. Le serveur sert à : garder le `serverSeed` **secret** jusqu'à la
révélation, **collecter** les `clientSeed` des premiers parieurs, faire
autorité sur le **timing** et les **soldes**.

## La couture (déjà en place côté client)

Le moteur (`src/engine/engine.ts`) ne génère pas lui-même l'aléa : il consomme
une **source de tours injectable**.

- Aujourd'hui : `SharedWorld` (`src/engine/sharedWorld.ts`) — timeline
  déterministe dérivée d'une graine **publique** + index de période + index de
  tour. `FairnessProvider` (`src/engine/fairness.ts`) est aussi injectable.
- Demain : une `ServerRoundSource` implémentera la **même forme** de données,
  alimentée par le backend. Le reste du jeu (UI, paris, vérificateur) ne change
  pas.

### Contrat serveur visé (esquisse)

```
GET  /round/current      → { roundId, serverSeedHash, clientSeeds:[…], phase, startsAt }
                           (le crashPoint N'EST PAS renvoyé avant la révélation)
WS   /round/stream       → push: phase, multiplicateur live, puis { type:"crash", crashPoint, serverSeed }
POST /round/seed         → le joueur soumet son clientSeed (les 3 premiers du tour comptent)
POST /bet  /cashout      → mises/encaissements (autorité serveur ; argent fictif pour l'instant)
GET  /round/{id}/verify  → serverSeed révélé + clientSeeds → recalcul vérifiable
```

Le vérificateur provably fair de l'UI reste identique : il recalcule le hash et
le point de crash à partir des graines révélées.

> Hors-périmètre tant qu'on reste en démo : authentification, portefeuille réel,
> anti-fraude, conformité. Aucune passerelle vers de l'argent réel.
