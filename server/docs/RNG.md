# Deep Diver — Générateur d'aléa & équité (provably fair)

Le résultat de chaque tour est déterminé par un schéma **commit-reveal** à graine
**secrète**, identique dans sa formule à la vérification côté joueur, mais
alimenté côté serveur par un CSPRNG.

## Graines

- **`serverSeed`** : 32 octets tirés par un CSPRNG (`node:crypto.randomBytes`),
  **secrets** jusqu'à la révélation après le crash.
- **`clientSeed`** : chaîne publique. En production (modèle Aviator), on peut y
  concaténer les graines des premiers parieurs afin qu'**aucune partie** — ni
  l'opérateur, ni un joueur — ne contrôle seule le résultat.
- **`nonce`** : compteur de tour.

## Engagement (commit) puis révélation (reveal)

1. **Avant** le tour, le serveur publie `serverSeedHash = SHA-256(serverSeed)`.
   Il s'engage ainsi sur la graine sans la dévoiler : il ne peut plus l'adapter
   aux mises.
2. **Après** le crash, le serveur révèle `serverSeed`. Comme
   `SHA-256(serverSeed)` doit égaler l'engagement publié, toute substitution est
   détectable.

## Dérivation du point de crash

```
message    = `${serverSeed}:${clientSeed}:${nonce}`
hash       = SHA-256(message)                       // hex
int        = 32 premiers bits de hash               // entier non signé 0..2³²−1
brut       = (2³² / (int + 1)) · (1 − houseEdge)
crashPoint = min(maxMultiplier, max(1.00, floor(brut · 100) / 100))
```

- `houseEdge = 0,03` (RTP 97 %), `maxMultiplier = 1 000 000`.
- La troncature à 2 décimales et le plancher `1.00` produisent les crashs
  instantanés (≈ 3,96 % des tours).
- La distribution obtenue vérifie `P(crash ≥ m) = (1 − edge)/m` (voir
  [math-model](math-model.md)).

## Propriétés de sécurité

- **Imprévisible côté joueur** : la graine serveur est secrète ; seul son hash
  est connu avant le tour.
- **Inadaptable côté opérateur** : l'engagement fige la graine avant les mises.
- **Vérifiable par tous** : après révélation, n'importe quel outil SHA-256
  reproduit le résultat (voir [VERIFY](VERIFY.md)).
- **Indépendant du réseau** : `deriveCrashPoint` est une fonction **pure**.

## Référence d'implémentation

`src/rng/provablyFair.ts` : `generateServerSeed`, `commitServerSeed`,
`deriveCrashPoint`, `verifyRound`. Les fonctions de distribution sont dans
`src/math/crash.ts` (`uint32FromHashHex`, `crashPointFromUint32`).
