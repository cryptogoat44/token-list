/**
 * Point d'entrée du Remote Game Server.
 *
 * Démarre le moteur de jeu autoritaire + la passerelle WebSocket sur un serveur
 * HTTP (qui expose aussi /health). Lancement : `npm run dev` ou `npm start`.
 *
 * Les modules wallet (étape 4), audit (5), conformité/geo-gating (6) viendront
 * s'enficher ici. Hébergement portable (Docker + variables d'env).
 */
import { createServer } from "node:http";
import { GameEngine } from "./game/engine";
import { RealtimeGateway } from "./realtime/gateway";

const PORT = Number(process.env.PORT ?? 8080);

const engine = new GameEngine();

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "deep-diver-rgs", time: Date.now() }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Deep Diver RGS — serveur de jeu (WebSocket). Voir /health.");
});

const gateway = new RealtimeGateway({ engine });
gateway.attach(http);

http.listen(PORT, () => {
  console.log(`[RGS] Deep Diver server à l'écoute sur :${PORT} (HTTP + WebSocket)`);
});

function shutdown(): void {
  console.log("[RGS] arrêt…");
  gateway.stop();
  http.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
