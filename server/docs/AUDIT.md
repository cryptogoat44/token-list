# Deep Diver — Journal d'audit (schéma & vérification)

Registre **append-only**, **chaîné par hash** : chaque enregistrement scelle son
contenu et le hash du précédent. Retirer ou modifier une ligne casse la chaîne et
devient détectable. Tous les événements autoritaires y sont journalisés.

## Schéma d'un enregistrement

| Champ | Type | Description |
| --- | --- | --- |
| `seq` | entier | Index monotone à partir de 0. |
| `timestamp` | entier (ms) | Horodatage serveur. |
| `type` | chaîne | Type d'événement (voir ci-dessous). |
| `payload` | objet JSON | Données de l'événement. |
| `prevHash` | hex(64) | Hash de l'enregistrement précédent (`0×64` pour `seq = 0`). |
| `hash` | hex(64) | `SHA-256` de l'enregistrement scellé. |

Calcul du hash (sérialisation **canonique** : clés triées récursivement) :

```
hash = SHA-256(canonicalJson({ seq, timestamp, type, payload, prevHash }))
```

`GENESIS = "0".repeat(64)`. La sérialisation canonique garantit que deux
enregistrements équivalents produisent le même hash, indépendamment de l'ordre
des clés.

## Types d'événements

| `type` | Payload (clés) |
| --- | --- |
| `round_open` | `roundId, serverSeedHash, startedAt, bettingEndsAt` |
| `bet_accepted` | `roundId, betId, playerId, amountCents` |
| `bet_rejected` | `roundId, betId, playerId, amountCents, reason` |
| `cashout` | `roundId, betId, playerId, multiplier, payoutCents, atServerTime` |
| `crash_revealed` | `roundId, crashPoint, serverSeed, serverSeedHash, clientSeed, nonce, houseEdge, maxMultiplier` |
| `settlement` | `roundId, crashPoint, totalStakedCents, totalPaidCents, instructions[]` |
| `wallet_movement` | `kind (debit/credit/rollback), txId, playerId, amountCents, ok, balanceCents, code, roundId, betId` |
| `access_denied` | `playerId, country, reason` |
| `rg_block` | `playerId, reason, amountCents` |

Le payload `crash_revealed` embarque `houseEdge`/`maxMultiplier` afin que la
rejouabilité de l'équité soit **autonome**.

## Stockage (interface `AuditStore`)

`append`, `head`, `read(fromSeq, toSeq)`, `count`, `verify`. Implémentations :

- **`MemoryAuditStore`** — défaut, pour tests/démo.
- **`FileAuditStore`** — JSONL (une ligne par enregistrement) ; `verify()` relit
  le **disque** (détecte une altération externe). Activé par `AUDIT_FILE`.
- **PostgreSQL** (à venir) — même interface, schéma indicatif :

```sql
CREATE TABLE audit_log (
  seq        BIGINT PRIMARY KEY,
  ts         BIGINT      NOT NULL,
  type       TEXT        NOT NULL,
  payload    JSONB       NOT NULL,
  prev_hash  CHAR(64)    NOT NULL,
  hash       CHAR(64)    NOT NULL UNIQUE
);
-- append-only : aucun UPDATE/DELETE accordé au rôle applicatif.
```

## Endpoints HTTP

| Route | Réponse |
| --- | --- |
| `GET /audit/verify` | Intégrité de la chaîne (`ok`, `count`, `head` ou point de rupture). |
| `GET /audit/replay` | Re-dérive l'équité + recontrôle l'arithmétique des règlements. |
| `GET /audit` | Métadonnées + fin du journal (200 derniers enregistrements). |

## Rejouabilité

`replayAudit()` (`src/audit/auditReplay.ts`) parcourt le journal et, pour chaque
`crash_revealed`, re-dérive le point de crash via `verifyRound()` (cf.
[VERIFY](VERIFY.md)) ; pour chaque `settlement`, vérifie que le total payé égale
la somme des crédits et que le `crashPoint` correspond à la révélation.
