import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { GameEngine } from "../game/engine";
import { RealtimeGateway } from "./gateway";
import type { RngProvider } from "../game/rngProvider";
import type { ServerMessage } from "./protocol";

/** RNG scripté : crashPoint fixe (tour long pour laisser le temps d'encaisser). */
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
  server = null;
  gateway = null;
  ws = null;
});

async function startServer(): Promise<number> {
  // k élevé + betting court → tour rapide mais avec une vraie fenêtre RUNNING.
  const engine = new GameEngine({
    rng: fixedRng(10),
    config: { durations: { bettingMs: 1500, crashMs: 300, settlementMs: 300 }, math: { growthRateK: 1 } },
  });
  gateway = new RealtimeGateway({ engine, tickIntervalMs: 40 });
  server = createServer();
  gateway.attach(server);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server!.address() as AddressInfo).port;
}

function waitFor(
  received: ServerMessage[],
  pred: (m: ServerMessage) => boolean,
  timeoutMs = 8000,
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const found = received.find(pred);
    if (found) return resolve(found);
    const start = Date.now();
    const id = setInterval(() => {
      const f = received.find(pred);
      if (f) {
        clearInterval(id);
        resolve(f);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id);
        reject(new Error("timeout en attendant le message"));
      }
    }, 20);
  });
}

describe("RealtimeGateway — intégration WebSocket", () => {
  it("diffuse l'état, accepte une mise puis un encaissement, sans jamais exposer crashAt", async () => {
    const port = await startServer();
    const received: ServerMessage[] = [];
    ws = new WebSocket(`ws://127.0.0.1:${port}/?player=tester`);
    ws.on("message", (d) => received.push(JSON.parse(d.toString()) as ServerMessage));
    await new Promise<void>((resolve, reject) => {
      ws!.on("open", () => resolve());
      ws!.on("error", reject);
    });

    // Bienvenue + état initial.
    const welcome = await waitFor(received, (m) => m.t === "welcome");
    expect(welcome.t === "welcome" && welcome.playerId).toBe("tester");

    // On attend une frame BETTING puis on mise.
    await waitFor(received, (m) => m.t === "state" && m.state.phase === "BETTING");
    ws.send(JSON.stringify({ t: "place_bet", betId: "b1", amountCents: 1000 }));
    const betAck = await waitFor(received, (m) => m.t === "bet_ack");
    expect(betAck.t === "bet_ack" && betAck.ok).toBe(true);

    // On attend RUNNING puis on encaisse (horodatage serveur).
    await waitFor(received, (m) => m.t === "state" && m.state.phase === "RUNNING");
    ws.send(JSON.stringify({ t: "cashout", betId: "b1" }));
    const cashAck = await waitFor(received, (m) => m.t === "cashout_ack");
    expect(cashAck.t === "cashout_ack" && cashAck.ok).toBe(true);
    if (cashAck.t === "cashout_ack" && cashAck.ok) {
      expect(cashAck.multiplier!).toBeGreaterThan(1);
      expect(cashAck.payoutCents!).toBeGreaterThan(1000);
    }

    // Le crash finit par être révélé (graine dévoilée).
    const crashed = await waitFor(received, (m) => m.t === "crashed");
    expect(crashed.t === "crashed" && crashed.crashPoint).toBe(10);
    expect(crashed.t === "crashed" && crashed.serverSeed.length).toBeGreaterThan(0);

    // SÉCURITÉ : aucune frame d'état n'a jamais contenu crashAt.
    const leaked = received.some(
      (m) => m.t === "state" && Object.prototype.hasOwnProperty.call(m.state, "crashAt"),
    );
    expect(leaked).toBe(false);
  }, 20000);
});
