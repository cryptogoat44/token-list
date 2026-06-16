/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Source partagée client ↔ serveur (protocole de fil) : un seul fichier, importé
// des deux côtés via l'alias `@shared`. (Chemin absolu calculé sans dépendance
// à @types/node, pour garder le client léger.)
const sharedDir = new URL("../shared", import.meta.url).pathname;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Chemins relatifs pour pouvoir servir le build depuis n'importe quel sous-dossier.
  base: "./",
  resolve: {
    alias: { "@shared": sharedDir },
  },
  server: {
    // Autorise le dev-server à lire le dossier partagé situé hors de la racine.
    fs: { allow: [".", sharedDir] },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
