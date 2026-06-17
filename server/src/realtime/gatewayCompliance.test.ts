import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { GameEngine } from "../game/engine";
import { RealtimeGateway } from "./gateway";
import type { ServerMessage } from "./protocol";
import { ComplianceService } from "../compliance/complianceService";
import type { OperatorConfig } from "../compliance/types";

const OPERATOR: OperatorConfig = {
  operatorId: "demo",
  name: "Demo",
  jurisdictions: ["GB"],
  defaultAllow: false,
};

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

async function start(country: string): Promise<number> {
  const engine = new GameEngine();
  gateway = new RealtimeGateway({
    engine,
    tickIntervalMs: 40,
    compliance: new ComplianceService(),
    operator: OPERATOR,
    resolveCountry: () => country,
  });
  server = createServer();
  gateway.attach(server);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server!.address() as AddressInfo).port;
}

describe("RealtimeGateway — geo-gating", () => {
  it("refuse et ferme une connexion depuis la France", async () => {
    const port = await start("FR");
    const received: ServerMessage[] = [];
    let closed = false;
    ws = new WebSocket(`ws://127.0.0.1:${port}/?player=fr`);
    ws.on("message", (d) => received.push(JSON.parse(d.toString()) as ServerMessage));
    ws.on("close", () => {
      closed = true;
    });
    await new Promise<void>((resolve, reject) => {
      ws!.on("close", () => resolve());
      ws!.on("error", reject);
      setTimeout(() => reject(new Error("pas de fermeture")), 5000);
    });

    expect(closed).toBe(true);
    expect(received.some((m) => m.t === "welcome")).toBe(false);
    expect(received.some((m) => m.t === "error")).toBe(true);
  }, 10000);

  it("admet une connexion depuis une juridiction servie (GB)", async () => {
    const port = await start("GB");
    const received: ServerMessage[] = [];
    ws = new WebSocket(`ws://127.0.0.1:${port}/?player=gb`);
    ws.on("message", (d) => received.push(JSON.parse(d.toString()) as ServerMessage));
    await new Promise<void>((resolve, reject) => {
      ws!.on("open", () => resolve());
      ws!.on("error", reject);
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(received.some((m) => m.t === "welcome")).toBe(true);
  }, 10000);
});
