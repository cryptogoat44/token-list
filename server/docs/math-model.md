# Deep Diver — rapport du modèle mathématique

- Tours simulés : **1 000 000**
- Graine : `deep-diver-sim` (déterministe, reproductible)
- Avantage maison configuré : **3.00 %** → RTP cible **97.00 %**
- Plafond de multiplicateur : **1 000 000x**

## Crash instantané (1.00x)

Observé : **4.01 %** — théorique **3.96 %** (= 1 − (1−edge)/1.01 ; proche de l'avantage maison 3.00 % mais distinct).

## P(crash ≥ m) et RTP implicite par cible

| Cible m | P(crash ≥ m) observé | Théorie (1−edge)/m | RTP implicite (m × P) |
| ---: | ---: | ---: | ---: |
| 1.5x | 64.575 % | 64.667 % | 96.86 % |
| 2x | 48.353 % | 48.500 % | 96.71 % |
| 3x | 32.196 % | 32.333 % | 96.59 % |
| 5x | 19.305 % | 19.400 % | 96.52 % |
| 10x | 9.630 % | 9.700 % | 96.30 % |
| 50x | 1.921 % | 1.940 % | 96.06 % |
| 100x | 0.964 % | 0.970 % | 96.43 % |
| 1000x | 0.097 % | 0.097 % | 97.00 % |

Le RTP implicite doit rester proche de **97.00 %** à toute cible.

## Distribution des points de crash

| Intervalle | Tours | Part |
| :-- | ---: | ---: |
| 1–1.5x | 354 249 | 35.425 % |
| 1.5–2x | 162 217 | 16.222 % |
| 2–5x | 290 487 | 29.049 % |
| 5–10x | 96 744 | 9.674 % |
| 10–50x | 77 090 | 7.709 % |
| 50–100x | 9 570 | 0.957 % |
| 100–1000x | 8 673 | 0.867 % |
| 1000–∞x | 970 | 0.097 % |

## Statistiques

- Médiane (p50) : **1.93x**
- p90 : **9.62x** · p99 : **96.35x**
- Maximum observé : **1000000.00x**
- Moyenne : **13.76x** _(sensible à la longue traîne, à interpréter avec prudence)_
