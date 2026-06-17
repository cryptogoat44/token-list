# Deep Diver — Guide de vérification (provably fair)

Toute personne peut vérifier qu'un tour n'a pas été truqué, avec **n'importe quel
outil SHA-256**. Après le crash, le serveur révèle `serverSeed` ; l'engagement
`serverSeedHash` a été publié **avant** le tour.

## Étape 1 — Vérifier l'engagement

Calculez `SHA-256(serverSeed)` et comparez à `serverSeedHash` annoncé avant le
tour. S'ils diffèrent, la graine a été substituée.

## Étape 2 — Recalculer le point de crash

```
message    = `${serverSeed}:${clientSeed}:${nonce}`
hash       = SHA-256(message)
int        = parseInt(hash.slice(0, 8), 16)        // 32 premiers bits
brut       = (2**32 / (int + 1)) * (1 - 0.03)       // edge = 3 %
crashPoint = min(1000000, max(1.00, floor(brut * 100) / 100))
```

## Exemple reproductible

| Champ | Valeur |
| --- | --- |
| `serverSeed` | `3b1f9c2a7d4e6f80a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718` |
| `clientSeed` | `deep-diver:demo` |
| `nonce` | `7` |
| `serverSeedHash` (engagement) | `0ce1be4c4d033852c5c6654b84510112f49f877369a46de0d0d96df3494b07b5` |
| `SHA-256(message)` | `7f359c5fb61f874b91477c22ab0e7a95f06b69827f3d5e108aebaec34a580955` |
| `int` (`0x7f359c5f`) | `2134219871` |
| **`crashPoint`** | **`1.95`** |

Calcul : `2³² / (2134219871 + 1) × 0,97 = 1,9520…` → `floor(195,20)/100 = 1.95`.

### Avec `shasum` (ligne de commande)

```bash
printf '%s' '3b1f9c2a7d4e6f80a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718:deep-diver:demo:7' | shasum -a 256
# → 7f359c5fb61f874b91477c22ab0e7a95f06b69827f3d5e108aebaec34a580955
```

### Avec Python

```python
import hashlib, math
serverSeed = "3b1f9c2a7d4e6f80a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718"
clientSeed, nonce, edge = "deep-diver:demo", 7, 0.03
h = hashlib.sha256(f"{serverSeed}:{clientSeed}:{nonce}".encode()).hexdigest()
i = int(h[:8], 16)
brut = (2**32 / (i + 1)) * (1 - edge)
print(min(1_000_000, max(1.00, math.floor(brut * 100) / 100)))   # 1.95
```

## Étape 3 — Vérification outillée

Le serveur expose `GET /audit/replay` : il **rejoue tout l'historique** journalisé
(re-dérive chaque point de crash depuis les graines révélées et recontrôle
l'arithmétique des règlements). La fonction `verifyRound()`
(`src/rng/provablyFair.ts`) fait la même vérification par programme.
