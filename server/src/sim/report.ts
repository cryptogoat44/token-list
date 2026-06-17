/**
 * Mise en forme Markdown d'un rapport de simulation (modèle mathématique).
 * Destiné à être joint à un dossier de certification : il montre, sur un grand
 * échantillon reproductible, que la distribution observée colle à la théorie
 * `P(crash ≥ m) = (1 − edge)/m` et que le RTP implicite ≈ 1 − edge à toute cible.
 */
import type { SimReport } from "./simulate";

function pct(x: number, digits = 2): string {
  return `${(x * 100).toFixed(digits)} %`;
}

export function formatReport(r: SimReport): string {
  const rtpTarget = (1 - r.math.houseEdge) * 100;
  const lines: string[] = [];
  lines.push(`# Deep Diver — rapport du modèle mathématique`);
  lines.push("");
  lines.push(`- Tours simulés : **${r.rounds.toLocaleString("fr-FR")}**`);
  lines.push(`- Graine : ${r.seed ? `\`${r.seed}\` (déterministe, reproductible)` : "CSPRNG (non reproductible)"}`);
  lines.push(`- Avantage maison configuré : **${pct(r.math.houseEdge)}** → RTP cible **${rtpTarget.toFixed(2)} %**`);
  lines.push(`- Plafond de multiplicateur : **${r.math.maxMultiplier.toLocaleString("fr-FR")}x**`);
  lines.push("");
  lines.push(`## Crash instantané (1.00x)`);
  lines.push("");
  lines.push(
    `Observé : **${pct(r.instantCrashRate)}** — théorique **${pct(r.theoreticalInstantRate)}** ` +
      `(= 1 − (1−edge)/1.01 ; proche de l'avantage maison ${pct(r.houseEdge)} mais distinct).`,
  );
  lines.push("");
  lines.push(`## P(crash ≥ m) et RTP implicite par cible`);
  lines.push("");
  lines.push(`| Cible m | P(crash ≥ m) observé | Théorie (1−edge)/m | RTP implicite (m × P) |`);
  lines.push(`| ---: | ---: | ---: | ---: |`);
  for (const t of r.targets) {
    lines.push(
      `| ${t.target}x | ${pct(t.empiricalProb, 3)} | ${pct(t.theoreticalProb, 3)} | ${pct(t.impliedRtp)} |`,
    );
  }
  lines.push("");
  lines.push(`Le RTP implicite doit rester proche de **${rtpTarget.toFixed(2)} %** à toute cible.`);
  lines.push("");
  lines.push(`## Distribution des points de crash`);
  lines.push("");
  lines.push(`| Intervalle | Tours | Part |`);
  lines.push(`| :-- | ---: | ---: |`);
  for (const b of r.buckets) {
    lines.push(`| ${b.label} | ${b.count.toLocaleString("fr-FR")} | ${pct(b.share, 3)} |`);
  }
  lines.push("");
  lines.push(`## Statistiques`);
  lines.push("");
  lines.push(`- Médiane (p50) : **${r.quantiles.p50.toFixed(2)}x**`);
  lines.push(`- p90 : **${r.quantiles.p90.toFixed(2)}x** · p99 : **${r.quantiles.p99.toFixed(2)}x**`);
  lines.push(`- Maximum observé : **${r.maxCrash.toFixed(2)}x**`);
  lines.push(
    `- Moyenne : **${r.meanCrash.toFixed(2)}x** _(sensible à la longue traîne, à interpréter avec prudence)_`,
  );
  lines.push("");
  return lines.join("\n");
}
