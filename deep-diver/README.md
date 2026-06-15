# 🤿 Deep Diver — crash game de démonstration (argent fictif)

Deep Diver reprend la mécanique d'un « crash game » (multiplicateur qui grimpe,
cash out avant le crash) et la re-thématise autour d'un **plongeur en apnée** :
plus il descend, plus le multiplicateur — et la profondeur en mètres — augmente.
À un instant tiré au sort **avant** le tour (système *provably fair*), le
plongeur fait une **syncope** : ceux qui ne sont pas remontés perdent leur mise.

> 🪙 **Argent fictif — jeu de démonstration, aucun gain réel.**
> Aucun paiement, dépôt ni retrait : uniquement des crédits virtuels locaux.
> Un vrai crash game est un jeu d'argent à risque dont les résultats sont
> imprévisibles : il est impossible de prédire le prochain crash.

---

## Lancer le projet

```bash
cd deep-diver
npm install
npm run dev        # serveur de développement (http://localhost:5173)
npm test           # tests unitaires du moteur (Vitest)
npm run build      # vérification TypeScript + bundle de production (dist/)
npm run preview    # sert le build de production
```

Prérequis : Node ≥ 18 (Web Crypto API). Dans le navigateur, servir via
`localhost` ou HTTPS (contexte sécurisé requis par `crypto.subtle`).

## Comment jouer

1. **Fenêtre de pari (5 s)** : saisissez une mise (boutons `−` `+` `½` `×2`
   `Min` `Max`) puis cliquez **Plonger**. Deux paniers indépendants peuvent
   être joués sur le même tour.
2. **Descente** : le multiplicateur part de `1.00x` et grimpe en continu, la
   profondeur s'affiche en mètres. Cliquez **Remonter** pour encaisser
   `mise × multiplicateur` à l'instant du clic.
3. **Syncope** : si elle survient avant votre remontée, la mise est perdue.
   Le tour suivant démarre automatiquement.

Options : **remontée auto** (cash out automatique à un multiplicateur cible),
**pari auto** (rejoue N tours, avec arrêt sur seuil de solde ou après une
perte), historique coloré des tours, statistiques de session, flux de joueurs
simulé, onglet **Lives** (liens Twitch/Kick), **célébrations** des gros
multiplicateurs, sons d'ambiance (touche `M` pour couper).

Bouton **🪙 Recharger** dans l'en-tête : ajoute 1 000 crédits fictifs à tout
moment (sans effacer les stats), pratique en démo si on a tout perdu.

Clavier : `Espace`/`1` = miser ou remonter (panier 1), `2` = panier 2,
`M` = son. Le solde (1 000 crédits au départ) est persistant ; l'onglet
**Stats** permet une réinitialisation complète (solde + statistiques).

### Expérience joueur (plaisir, maîtrise, confiance)

- **Carnet du plongeur** (bouton 📖) : records de toujours (profondeur,
  multiplicateur, plus longue série de remontées), plongées marquantes,
  **succès** cosmétiques, **apparence** (combinaison, traînée de bulles) et
  **réglages**.
- **Présets d'auto cash-out** (Prudent 1,3x / Équilibré 2x / Abysses 10x +
  personnalisés) avec, à côté de chaque cible, la **probabilité honnête**
  `(1 − edge)/m` de l'atteindre.
- **Sensation de jeu** : éclat de lumière et gerbe de bulles au cash-out, petit
  « pop », vibration mobile, multiplicateur qui « respire » et change de couleur
  avec la profondeur.
- **Transparence permanente** : RTP 97 % / avantage maison 3 % toujours
  affichés, bouton **« Vérifier ce tour »** après chaque plongée.
- **Accessibilité** : `prefers-reduced-motion` respecté (+ réglage in-app),
  libellés ARIA, navigation clavier.
- **Bien-être** : rappel de pause optionnel (15/30/60 min), doux et non
  bloquant ; bouton de pause/reset toujours accessible ; rappel honnête de la
  perte attendue.
- **Accueil** des nouveaux à la première visite (rejouable via « ? »).

> **Philosophie : plaisir sans manipulation.** Chaque fonctionnalité optimise le
> plaisir, la maîtrise et la confiance — jamais le « temps passé » ou la
> fréquence de mise. Aucune progression n'influe sur les probabilités ou
> l'économie ; aucun *dark pattern* (pas de faux *near-miss*, pas d'incitation à
> se refaire, pas de FOMO, pas de bonus de connexion obligeant, pas de
> passerelle vers de l'argent réel).

## La mécanique, en détail

### Cycle d'un tour

Machine à états en boucle : `BETTING` (5 s) → `DIVING` (durée variable) →
`CRASH` (1,6 s d'animation) → `RESULT` (2,6 s) → `BETTING`…
Le point de crash est calculé et **figé pendant la fenêtre de pari**, avant la
plongée — jamais ajusté selon les actions du joueur.

### Courbe du multiplicateur

```
multiplier(t) = e^(k·t)          k = 0.14 (≈ 2x en ~5 s, ≈ 10x en ~16 s)
profondeur(m) = (m − 1) × 10 m   (2x ⇒ −10 m, 10x ⇒ −90 m…)
```

Le tour s'arrête à l'instant exact `t = ln(crashPoint)/k`, calculé dès le
début de la plongée. La jauge d'oxygène est purement décorative.

### Point de crash & provably fair

Formule de référence (style Stake/BC.Game, 32 bits) :

```
hash       = SHA-256(serverSeed + ":" + clientSeed + ":" + nonce)
int        = 32 premiers bits du hash
crashPoint = max(1.00, floor((2^32 / (int + 1)) × (1 − houseEdge) × 100) / 100)
```

Avec `houseEdge = 3 %` (RTP 97 %, configurable dans
`src/engine/config.ts`), la distribution vérifie :

| Multiplicateur m | P(crash ≥ m) = 0.97/m |
| ---------------- | --------------------- |
| 2x               | ≈ 48,5 %              |
| 3x               | ≈ 32,3 %              |
| 10x              | ≈ 9,7 %               |
| 100x             | ≈ 0,97 % (~1/103)     |
| 100 000x         | ≈ 0,00097 % (~1/103 000) |

Les petits multiplicateurs sont fréquents, les gros exponentiellement rares,
et `1 − 0.97/1.01 ≈ 3,96 %` des tours (≈ l'ordre de grandeur de l'avantage
maison) « syncopent » instantanément à `1.00x`.

C'est **exactement le modèle d'Aviator (Spribe)** : même RTP 97 %, même
formule `P(crash ≥ m) = (1 − edge) / m`, et un multiplicateur **plafonné à
1 000 000x** (`config.maxMultiplier`). Les multiplicateurs « de dingue »
existent donc réellement mais sont astronomiquement rares — le plafond
n'affecte que ~1 tour sur un million et ne change pas l'avantage maison de
façon perceptible. Les gros tours sont mis en scène par des **célébrations**
(paliers Grande plongée → Fosse des Marianes).

### Mode lobby partagé (timeline synchronisée, sans serveur)

Par défaut le site tourne en **lobby unique** : tous les joueurs voient les
**mêmes tours, le même multiplicateur, au même instant**, sans aucun backend.
Le temps est découpé en périodes d'une heure ; dans chaque période, les points
de crash sont dérivés de façon déterministe d'une **graine publique** + l'index
de période + l'index du tour (même SHA-256). Chaque navigateur lit l'horloge
murale (UTC) et se place exactement sur le même tour que les autres
(`src/engine/sharedWorld.ts`, `src/engine/schedule.ts`).

Le solde, les paris et les statistiques restent **locaux** à chaque joueur ;
seule la timeline est commune. L'équité devient « **déterministe et publique** »
plutôt que commit-reveal : tout le monde peut recalculer n'importe quel tour à
partir de la graine publique. Pour revenir au mode solo (commit-reveal avec
`serverSeed` secret), il suffit de construire le moteur **sans** `sharedWorld`.

Protocole commit-reveal, vérifiable dans l'onglet **Équité** :

1. avant chaque tour, le jeu publie `SHA-256(serverSeed)` (engagement) ;
2. le `clientSeed` est éditable par le joueur (appliqué au tour suivant,
   nonce remis à 0) et le `nonce` s'incrémente à chaque tour ;
3. après le crash, le `serverSeed` est révélé ;
4. le **vérificateur intégré** (ou n'importe quel outil SHA-256 externe)
   permet de recalculer le point de crash et de confirmer l'engagement.
   Un clic sur un tour de l'historique préremplit le vérificateur.

## Architecture

```
deep-diver/
├── index.html, vite.config.ts, tsconfig.json
└── src/
    ├── engine/                 ← moteur pur, testable, AUCUNE dépendance DOM
    │   ├── config.ts             constantes (edge, max 1 000 000x, k, durées, bornes)
    │   ├── types.ts              phases, paniers, snapshot, événements
    │   ├── fairness.ts           SHA-256, formule du crash, commit-reveal, vérificateur
    │   ├── curve.ts              courbe e^(k·t), inverse, profondeur
    │   ├── wallet.ts             économie en centimes entiers (jamais de solde négatif)
    │   ├── schedule.ts           localisation tour/phase déterministe (timeline)
    │   ├── sharedWorld.ts        lobby partagé : graine publique + horloge murale
    │   ├── engine.ts             machine à états pilotée par tick(now), paris,
    │   │                         auto cash out/auto bet, stats, mode lobby partagé
    │   └── __tests__/            76 tests Vitest (distribution, équité, cycle, sync)
    ├── sim/liveBets.ts         ← faux joueurs « en direct » (déterministes par tour)
    └── ui/                     ← rendu React + Canvas
        ├── App.tsx               assemblage, clavier, sons, toasts, onglets, recharge
        ├── useEngine.ts          pont moteur ↔ React (rAF + horloge murale + localStorage)
        ├── sound.ts              sons synthétisés Web Audio (aucun asset)
        ├── format.ts             formats fr-FR + paliers de célébration
        ├── streamsConfig.ts      chaînes Twitch/Kick de l'onglet « Lives »
        ├── scene/                canvas : océan, plongeur, bulles, faune, syncope
        └── components/           mise, historique, stats, équité, lives, bandeaux
```

Le moteur est **déterministe** : il ne lit jamais l'horloge lui-même, il est
avancé par `tick(now)` (requestAnimationFrame côté UI, horloge simulée dans
les tests) et l'aléa est injectable (`FairnessProvider`), ce qui permet de
scénariser des tours exacts dans les tests.

Garanties testées (`npm test`) :

- distribution des crash points conforme à `P(crash ≥ m) = 0.97/m`
  (48,5 % / 32,3 % / 9,7 %) sur 200 000 tirages, ~3-4 % de tours à `1.00x` ;
- **lobby partagé** : deux moteurs avec la même graine publique et la même
  horloge produisent une partie strictement identique (phase, multiplicateur,
  historique) — c'est le test de synchronisation du mode lobby ;
- vecteurs officiels SHA-256, déterminisme seeds → crash point, détection de
  seed falsifié ou de crash annoncé mensonger par le vérificateur ;
- cash out refusé si le clic arrive après l'instant exact du crash, même sans
  tick intermédiaire ; auto cash out payé exactement à la cible, y compris
  quand un même tick saute la cible **et** le crash (sémantique temps continu) ;
- gain = mise × multiplicateur au centime près, solde jamais négatif, bornes
  de mise, double mise, annulation, pari auto et conditions d'arrêt.

## Stack

React 19 + TypeScript + Vite · Tailwind CSS 4 · Canvas 2D · Web Crypto API ·
Web Audio API · Vitest. Tout tourne côté client (aucun backend) ; un futur
mode multijoueur n'aurait qu'à fournir une autre implémentation de
`FairnessProvider` et un transport d'état.

## 🛟 Jeu responsable

Ce projet est une démonstration technique. Les vrais jeux d'argent de ce type
présentent un risque réel de pertes : l'avantage maison rend l'espérance de
gain négative et **aucune stratégie ne permet de prédire le prochain crash**.
En France, si le jeu devient un problème : Joueurs Info Service —
09 74 75 13 13 (appel non surtaxé), joueurs-info-service.fr.
