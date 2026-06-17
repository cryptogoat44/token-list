/**
 * Point d'entrée du Remote Game Server.
 *
 * Assemble le moteur autoritaire + la passerelle WebSocket + le wallet
 * (seamless) + le journal d'audit (chaîné par hash), et expose des endpoints
 * HTTP de santé et d'audit. Lancement : `npm run dev` ou `npm start`.
 *
 * Stockage d'audit : EN MÉMOIRE par défaut (zéro dépendance) ; si la variable
 * d'environnement `AUDIT_FILE` est définie, journal persistant sur FICHIER
 * (JSONL). Un adaptateur PostgreSQL pourra remplacer le store sans toucher au
 * reste (même interface `AuditStore`).
 *
 * La conformité / geo-gating (étape 6) viendra s'enficher ici.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { GameEngine } from "./game/engine";
import { RealtimeGateway } from "./realtime/gateway";
import { MemoryAuditStore } from "./audit/memoryAuditStore";
import { FileAuditStore } from "./audit/fileAuditStore";
import { AuditLogger } from "./audit/auditLogger";
import { replayAudit } from "./audit/auditReplay";
import type { AuditStore } from "./audit/types";
import { MockWalletAdapter } from "./wallet/mockWalletAdapter";
import { WalletService } from "./wallet/walletService";
import type { WalletContext } from "./wallet/types";
import { ComplianceService } from "./compliance/complianceService";
import { ResponsibleGamingService } from "./compliance/responsibleGaming";
import { countryFromHeaders } from "./compliance/geo";
import type { OperatorConfig } from "./compliance/types";

const PORT = Number(process.env.PORT ?? 8080);
/** Solde fictif de départ pour un nouveau joueur de démo (1 000 crédits). */
const DEMO_START_CENTS = Number(process.env.DEMO_START_CENTS ?? 100_000);

const engine = new GameEngine();

// Journal d'audit : fichier si AUDIT_FILE, sinon mémoire.
const auditStore: AuditStore = process.env.AUDIT_FILE
  ? new FileAuditStore(process.env.AUDIT_FILE)
  : new MemoryAuditStore();
const audit = new AuditLogger(auditStore, {
  houseEdge: engine.math.houseEdge,
  maxMultiplier: engine.math.maxMultiplier,
});

// Wallet « seamless » : adaptateur mock (monnaie fictive) pour la démo.
// Un opérateur réel fournirait son propre adaptateur (même interface).
const walletAdapter = new MockWalletAdapter({ defaultCurrency: "FUN" });
const wallet = new WalletService(walletAdapter);

// À la connexion, on provisionne un compte de démo si nécessaire (sans jamais
// réinitialiser un solde existant) et on renvoie le contexte wallet.
const resolveContext = async (playerId: string): Promise<WalletContext | null> => {
  walletAdapter.ensureAccount(playerId, DEMO_START_CENTS);
  const b = await walletAdapter.getBalance(playerId);
  return b.ok ? { playerId, currency: b.currency } : null;
};

// Conformité : geo-gating + opérateur de démo. France et US sont bloqués par
// défaut (table des juridictions) ; l'opérateur démo est permissif ailleurs
// (monnaie fictive).
const compliance = new ComplianceService();
const DEMO_OPERATOR: OperatorConfig = {
  operatorId: "demo",
  name: "Deep Diver Demo",
  jurisdictions: [],
  defaultAllow: true,
};
// En production le pays vient de l'edge (Cloudflare…). En local/dev sans en-tête,
// on retombe sur DEFAULT_COUNTRY (mettre « FR » resterait bloqué de toute façon).
const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY ?? "GB";
const resolveCountry = (req: IncomingMessage): string | null =>
  countryFromHeaders(req.headers) ?? DEFAULT_COUNTRY;

// Jeu responsable : rappel (« reality check ») après 20 min. Pas de plafond en
// démo fictive ; un opérateur réel branche ici ses limites réglementaires.
const responsibleGaming = new ResponsibleGamingService({
  limits: { realityCheckMs: 20 * 60 * 1000 },
});

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const http = createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (url === "/health") {
    return json(res, 200, { ok: true, service: "deep-diver-rgs", time: Date.now() });
  }
  if (url === "/audit/verify") {
    return json(res, 200, await auditStore.verify());
  }
  if (url === "/audit/replay") {
    return json(res, 200, replayAudit(await auditStore.read()));
  }
  if (url.startsWith("/audit")) {
    const records = await auditStore.read();
    const head = await auditStore.head();
    // On ne renvoie que la fin du journal (les 200 derniers) pour rester léger.
    return json(res, 200, {
      count: records.length,
      head: head?.hash ?? null,
      records: records.slice(-200),
    });
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Deep Diver RGS — serveur de jeu (WebSocket). Voir /health, /audit/verify, /audit/replay.");
});

const gateway = new RealtimeGateway({
  engine,
  wallet,
  audit,
  resolveContext,
  compliance,
  operator: DEMO_OPERATOR,
  resolveCountry,
  responsibleGaming,
});
gateway.attach(http);

http.listen(PORT, () => {
  console.log(`[RGS] Deep Diver server à l'écoute sur :${PORT} (HTTP + WebSocket)`);
  console.log(
    `[RGS] audit: ${process.env.AUDIT_FILE ? `fichier ${process.env.AUDIT_FILE}` : "mémoire"} · wallet: mock (FUN) · geo: défaut ${DEFAULT_COUNTRY} (FR/US bloqués)`,
  );
});

function shutdown(): void {
  console.log("[RGS] arrêt…");
  gateway.stop();
  http.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
