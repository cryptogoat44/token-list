/**
 * CLI de simulation : génère le rapport du modèle mathématique.
 *
 *   npm run sim                 # 1 000 000 tours, graine déterministe
 *   ROUNDS=5000000 npm run sim  # plus de tours
 *   SIM_OUT=model.md npm run sim  # écrit aussi le rapport dans un fichier
 *
 * Reproductible par défaut (graine fixe) → idéal pour un dossier d'audit.
 */
import { writeFileSync } from "node:fs";
import { simulate } from "./simulate";
import { formatReport } from "./report";

const rounds = Number(process.argv[2] ?? process.env.ROUNDS ?? 1_000_000);
const seed = process.env.SIM_SEED ?? "deep-diver-sim";

const started = Date.now();
const report = simulate({ rounds, seed });
const md = formatReport(report);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

process.stdout.write(`${md}\n`);
process.stderr.write(`\n[sim] ${rounds.toLocaleString("fr-FR")} tours en ${elapsed}s\n`);

if (process.env.SIM_OUT) {
  writeFileSync(process.env.SIM_OUT, md, "utf8");
  process.stderr.write(`[sim] rapport écrit dans ${process.env.SIM_OUT}\n`);
}
