# Deep Diver RGS — Architecture

Remote Game Server **serveur-autoritaire** : le serveur est la **seule source de
vérité**. Le client n'est qu'un afficheur ; aucun résultat, multiplicateur ou
point de crash n'est décidé côté client. Le studio fournit le **contenu de jeu**,
l'**opérateur** licencié détient les fonds, le KYC et la licence.

## Composants

| Couche | Module | Responsabilité |
| --- | --- | --- |
| Mathématiques | `src/math/` | Distribution du crash, courbe `e^{k·t}`, config (RTP/edge/plafond). |
| Aléa | `src/rng/` | RNG provably-fair, graine secrète CSPRNG, commit-reveal, vérificateur. |
| Jeu | `src/game/` | Tour autoritaire + moteur (BETTING → RUNNING → CRASH → SETTLEMENT). |
| Temps réel | `src/realtime/` | Passerelle WebSocket : diffusion d'état public, intentions horodatées serveur. |
| Protocole | `../shared/` | Contrat de fil unique, partagé client ↔ serveur. |
| Wallet | `src/wallet/` | API « seamless » opérateur (débit/crédit/rollback idempotents). |
| Audit | `src/audit/` | Journal append-only chaîné par hash, rejouable. |
| Conformité | `src/compliance/` | Geo-gating par juridiction/opérateur, jeu responsable. |
| Simulation | `src/sim/` | Banc de test à grande échelle + rapport du modèle mathématique. |

## Principes serveur-autoritaire

1. **Le point de crash est figé à la création du tour** (jamais ajusté ensuite),
   à partir d'une graine **secrète** dont seul le hash (engagement) est publié.
2. **L'état diffusé ne contient jamais `crashAt`** ni la graine avant le crash :
   le client ne peut pas prédire la syncope. La graine est révélée **après**.
3. **L'instant d'encaissement qui fait foi est l'horodatage SERVEUR** à la
   réception de l'intention, jamais l'horloge du client (anti-triche par latence).
4. **Montants en centimes entiers**, jamais de flottant sur l'argent.

## Flux d'un tour

```
roundCreated ─▶ BETTING (mises = débit wallet) ─▶ RUNNING (encaissements)
     │                                                   │
     ▼                                                   ▼
 audit round_open                                   audit cashout
                          CRASH ─▶ SETTLEMENT
                            │            │
                            ▼            ▼
                  audit crash_revealed   wallet.settle (crédits) + audit
                  (graine révélée)       settlement + wallet_movement
```

## Connexion d'un joueur

1. **Geo-gating** (conformité) : pays résolu via l'edge/CDN ; refus + fermeture
   si juridiction interdite (**France bloquée par défaut**).
2. **Authentification wallet** : résolution du contexte (opérateur réel) ou
   provisionnement d'un compte fictif (démo).
3. Réception de l'état public + des révélations de crash ; envoi d'intentions
   `place_bet` / `cashout`.

## Déploiement

- Node 20+, `npm start` (tsx) ou build/compilation. HTTP (`/health`, `/audit/*`)
  + WebSocket sur le même port (`PORT`, défaut 8080).
- Variables : `PORT`, `AUDIT_FILE` (journal sur fichier), `DEFAULT_COUNTRY`
  (fallback dev), `DEMO_START_CENTS`.
- Hébergement portable (conteneur). Le journal d'audit peut passer de mémoire →
  fichier → PostgreSQL **sans changer le reste** (interface `AuditStore`).

Voir aussi : [GAME-RULES](GAME-RULES.md) · [RNG](RNG.md) · [VERIFY](VERIFY.md) ·
[AUDIT](AUDIT.md) · [math-model](math-model.md) · [CERTIFICATION](CERTIFICATION.md).
