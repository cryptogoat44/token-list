# Deep Diver — Préparation à la certification

Ce document récapitule comment le RGS adresse les exigences usuelles des
laboratoires (GLI-19 « Interactive Gaming Systems », normes iTech Labs / eCOGRA).
Ce n'est **pas** une certification : c'est l'état de préparation et la
cartographie vers les documents et le code.

> Statut : socle technique prêt pour audit. La certification effective requiert
> un laboratoire accrédité, un opérateur licencié et l'environnement de production.

## Cartographie des exigences

| Exigence | Couverture | Référence |
| --- | --- | --- |
| RNG imprévisible, non manipulable | Graine CSPRNG secrète + commit-reveal | [RNG](RNG.md) |
| RTP annoncé = RTP réel | `P(crash ≥ m) = (1−edge)/m`, RTP 97 % constant | [GAME-RULES](GAME-RULES.md), [math-model](math-model.md) |
| Reproductibilité du modèle mathématique | Simulation 1 M tours, graine déterministe | [math-model](math-model.md), `npm run sim` |
| Vérification indépendante par le joueur | Reveal + guide pas-à-pas, tout outil SHA-256 | [VERIFY](VERIFY.md) |
| Serveur seule source de vérité | État sans `crashAt`, encaissement = horloge serveur | [ARCHITECTURE](ARCHITECTURE.md) |
| Traçabilité / piste d'audit infalsifiable | Journal append-only chaîné par hash, rejouable | [AUDIT](AUDIT.md) |
| Intégrité financière | Centimes entiers, wallet idempotent, rollback | [ARCHITECTURE](ARCHITECTURE.md), `src/wallet/` |
| Restrictions géographiques | Geo-gating par juridiction (**FR/US bloqués**) | `src/compliance/` |
| Jeu responsable | Auto-exclusion, plafonds de session, reality check | `src/compliance/responsibleGaming.ts` |
| Tests automatisés | Suite Vitest (cœur, temps réel, wallet, audit, conformité, simulation) | `npm test` |

## Limites et responsabilités

- **Monnaie fictive** dans la démo ; aucune passerelle vers de l'argent réel.
- **KYC, licence, détention des fonds et limites réglementaires** relèvent de
  l'**opérateur** licencié (le RGS appelle son wallet via une interface).
- La certification finale dépend de l'environnement de production (hébergement,
  gestion des secrets, sauvegarde du journal, séparation des rôles base de
  données pour l'append-only).

## Reproduire les preuves

```bash
cd server
npm install
npm test                                  # toute la suite
SIM_OUT=docs/math-model.md npm run sim     # régénère le rapport mathématique
npm start                                  # puis GET /audit/verify et /audit/replay
```
