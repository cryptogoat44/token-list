import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { GameEngine } from "../game/engine";
import { RealtimeGateway } from "./gateway";
import type { RngProvider } from "../game/rngProvider";
import type { ServerMessage } from "./protocol";
import { MockWalletAdapter } from "../wallet/mockWalletAdapter";
import { WalletService } from "../wallet/walletService";
import { MemoryAuditStore } from "../audit/memoryAuditStore";
import { AuditLogger } from "../audit/auditLogger";
import type { AuditEventType } from "../audit/types";

/** crashPoint fixe (tour long → temps de cash-out déterministe). */
function fixedRng(crashPoint: number): RngProvider {
  let i = 0;
  return {
    newServerSeed: () => `seed-${i}`,
    commit: (s) => `hash:${s}`,
    crashPoint: () => (i++, crashPoint),
  };
}

let server: Server | null = null;
let gateway: RealtimeGateway | null = null;
let ws: WebSocket | null = null;

afterEach(() => {
  ws?.close();
  gateway?.stop();
  server?.close();
  server = gateway = null;
  ws = null;
});

interface Harness {
  port: number;
  wallet: MockWalletAdapter;
  store: MemoryAuditStore;
}

async function startServer(startCents: number): Promise<Harness> {
  const engine = new GameEngine({
    rng: fixedRng(10),
    config: { durations: { bettingMs: 1500, crashMs: 300, settlementMs: 300 }, math: { growthRateK: 1 } },
  });
  const wallet = new MockWalletAdapter({ defaultCurrency: "FUN" });
  const store = new MemoryAuditStore();
  const audit = new AuditLogger(store, { houseEdge: engine.math.houseEdge, maxMultiplier: engine.math.maxMultiplier });
  gateway = new RealtimeGateway({
    engine,
    tickIntervalMs: 40,
    wallet: new WalletService(wallet),
    audit,
    resolveContext: (playerId) => {
      wallet.ensureAccount(playerId, startCents);
      return { playerId, currency: "FUN" };
    },
  });
  server = createServer();
  gateway.attach(server);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return { port: (server!.address() as AddressInfo).port, wallet, store };
}

function waitFor(
  received: ServerMessage[],
  pred: (m: ServerMessage) => boolean,
  timeoutMs = 8000,
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const id = setInterval(() => {
      const f = received.find(pred);
      if (f) {
        clearInterval(id);
        resolve(f);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id);
        reject(new Error("timeout"));
      }
    }, 15);
  });
}

function waitUntil(fn: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const id = setInterval(async () => {
      if (await fn()) {
        clearInterval(id);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id);
        reject(new Error("timeout (condition)"));
      }
    }, 25);
  });
}

describe("RealtimeGateway — wallet + audit branchés", () => {
  it("débite la mise, crédite le gain au règlement, et journalise une chaîne vérifiable", async () => {
    const { port, wallet, store } = await startServer(5000);
    const received: ServerMessage[] = [];
    ws = new WebSocket(`ws://127.0.0.1:${port}/?player=tester`);
    ws.on("message", (d) => received.push(JSON.parse(d.toString()) as ServerMessage));
    await new Promise<void>((resolve, reject) => {
      ws!.on("open", () => resolve());
      ws!.on("error", reject);
    });

    await waitFor(received, (m) => m.t === "welcome");

    // Mise pendant BETTING → débit du solde (5000 → 4000).
    await waitFor(received, (m) => m.t === "state" && m.state.phase === "BETTING");
    ws.send(JSON.stringify({ t: "place_bet", betId: "b1", amountCents: 1000 }));
    const betAck = await waitFor(received, (m) => m.t === "bet_ack");
    expect(betAck.t === "bet_ack" && betAck.ok).toBe(true);
    await waitUntil(async () => {
      const b = await wallet.getBalance("tester");
      return b.ok && b.balanceCents === 4000;
    });

    // Encaissement pendant RUNNING.
    await waitFor(received, (m) => m.t === "state" && m.state.phase === "RUNNING");
    ws.send(JSON.stringify({ t: "cashout", betId: "b1" }));
    const cashAck = await waitFor(received, (m) => m.t === "cashout_ack");
    expect(cashAck.t === "cashout_ack" && cashAck.ok).toBe(true);
    const payout = cashAck.t === "cashout_ack" ? cashAck.payoutCents ?? 0 : 0;
    expect(payout).toBeGreaterThan(1000);

    // Après le règlement, le gain est crédité : solde = 4000 + payout.
    await waitUntil(async () => {
      const b = await wallet.getBalance("tester");
      return b.ok && b.balanceCents === 4000 + payout;
    });

    // Le journal d'audit est intègre et contient les bons événements.
    const verify = await store.verify();
    expect(verify.ok).toBe(true);
    const types = (await store.read()).map((r) => r.type);
    const expected: AuditEventType[] = [
      "round_open",
      "bet_accepted",
      "cashout",
      "crash_revealed",
      "settlement",
      "wallet_movement",
    ];
    for (const t of expected) expect(types).toContain(t);
  }, 20000);

  it("refuse la mise si le solde est insuffisant (et n'engage rien dans le moteur)", async () => {
    const { port, wallet } = await startServer(500);
    const received: ServerMessage[] = [];
    ws = new WebSocket(`ws://127.0.0.1:${port}/?player=fauche`);
    ws.on("message", (d) => received.push(JSON.parse(d.toString()) as ServerMessage));
    await new Promise<void>((resolve, reject) => {
      ws!.on("open", () => resolve());
      ws!.on("error", reject);
    });

    await waitFor(received, (m) => m.t === "state" && m.state.phase === "BETTING");
    ws.send(JSON.stringify({ t: "place_bet", betId: "x", amountCents: 1000 }));
    const ack = await waitFor(received, (m) => m.t === "bet_ack");
    expect(ack.t === "bet_ack" && ack.ok).toBe(false);
    expect(ack.t === "bet_ack" && ack.reason).toBe("INSUFFICIENT_FUNDS");

    const b = await wallet.getBalance("fauche");
    expect(b.ok && b.balanceCents).toBe(500); // solde intact
  }, 20000);
});
