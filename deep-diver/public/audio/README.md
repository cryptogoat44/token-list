# Sons réels (optionnels) — souffle de plongeur

Déposez ici des fichiers MP3 pour **remplacer la synthèse** par de vrais
enregistrements. Tout fichier présent est chargé au démarrage ; tout fichier
absent → le jeu synthétise le son à la volée (rien ne casse).

| Fichier            | Quand il est joué                                   |
| ------------------ | --------------------------------------------------- |
| `inhale.mp3`       | Inspiration ample (phase de pari)                   |
| `exhale.mp3`       | Expiration entre deux inspirations                  |
| `final-inhale.mp3` | La grande inspiration finale, juste avant la plongée|
| `breath-hold.mp3`  | Bed du souffle retenu sous l'eau (idéalement bouclable) |
| `gasp.mp3`         | Souffle qui s'échappe à la syncope                  |
| `relief.mp3`       | Souffle de soulagement à la remontée réussie        |

Gardez des fichiers courts (1–3 s, sauf `breath-hold` qui boucle) et légers.

## Où trouver des sons libres de droits

Utilisez uniquement des sons **CC0 / domaine public** (réutilisables et
redistribuables sans condition) afin de pouvoir les committer ici :

- **BigSoundBank** — sons CC0, téléchargement direct : https://bigsoundbank.com (rechercher « souffle », « respiration », « essoufflé »).
- **Pixabay Sound Effects** — https://pixabay.com/sound-effects/search/breathing/ (licence Pixabay, sans attribution).
- **Freesound** — https://freesound.org (filtrer par licence **Creative Commons 0**).
- **99Sounds** — https://99sounds.org (packs sous-marins / souffle).

> Téléchargez le fichier, renommez-le selon le tableau ci-dessus, placez-le dans
> ce dossier, puis `npm run build`. Pensez à conserver la trace de la licence et
> de l'auteur de chaque son que vous ajoutez.
