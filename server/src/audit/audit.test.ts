import { afterEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { MemoryAuditStore } from "./memoryAuditStore";
import { FileAuditStore } from "./fileAuditStore";
import { canonicalJson, GENESIS_HASH, makeRecord, verifyChain } from "./hashChain";
import { AuditLogger } from "./auditLogger";
import { replayAudit } from "./auditReplay";
import { commitServerSeed, deriveCrashPoint } from "../rng/provablyFair";
import type { AuditRecord } from "./types";
import type { RoundSettlement } from "../game/types";

const MATH = { houseEdge: 0.03, maxMultiplier: 1_000_000 };

const tmpFiles: string[] = [];
function tmpFile(): string {
  const p = join(tmpdir(), `dd-audit-${randomUUID()}.jsonl`);
  tmpFiles.push(p);
  return p;
}
afterEach(async () => {
  await Promise.all(tmpFiles.splice(0).map((p) => rm(p, { force: true })));
});

describe("hashChain", () => {
  it("canonicalise indépendamment de l'ordre des clés", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it("vérifie une chaîne construite à la main et rejette un seq non contigu", () => {
    const a = makeRecord(0, GENESIS_HASH, "round_open", { roundId: 1 }, 1000);
    const b = makeRecord(1, a.hash, "crash_revealed", { roundId: 1 }, 1001);
    expect(verifyChain([a, b]).ok).toBe(true);
    // Un maillon retiré (seq saute de 0 à 2) doit être rejeté.
    const bad = verifyChain([a, makeRecord(2, a.hash, "settlement", {}, 1002)]);
    expect(bad.ok).toBe(false);
  });
});

describe("MemoryAuditStore", () => {
  it("scelle, chaîne et vérifie les enregistrements", async () => {
    let t = 1000;
    const store = new MemoryAuditStore({ now: () => t++ });
    const r0 = await store.append("round_open", { roundId: 1, serverSeedHash: "h1" });
    const r1 = await store.append("bet_accepted", { roundId: 1, betId: "b", playerId: "p", amountCents: 500 });

    expect(r0.seq).toBe(0);
    expect(r0.prevHash).toBe(GENESIS_HASH);
    expect(r1.seq).toBe(1);
    expect(r1.prevHash).toBe(r0.hash);
    expect((await store.head())?.seq).toBe(1);
    expect(await store.count()).toBe(2);

    const v = await store.verify();
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.count).toBe(2);
  });

  it("détecte une altération de payload (hash ne correspond plus)", async () => {
    const store = new MemoryAuditStore({ now: () => 1000 });
    await store.append("round_open", { roundId: 1 });
    await store.append("bet_accepted", { roundId: 1, amountCents: 100 });
    const records = await store.read();
    // On falsifie une copie en conservant l'ancien hash.
    const tampered: AuditRecord[] = records.map((r) => ({ ...r, payload: { ...r.payload } }));
    tampered[1].payload.amountCents = 999_999;
    const v = verifyChain(tampered);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.brokenAt).toBe(1);
  });

  it("lit une plage par seq", async () => {
    const store = new MemoryAuditStore({ now: () => 1 });
    for (let i = 0; i < 5; i++) await store.append("round_open", { roundId: i });
    const slice = await store.read({ fromSeq: 1, toSeq: 3 });
    expect(slice.map((r) => r.seq)).toEqual([1, 2, 3]);
  });
});

describe("FileAuditStore", () => {
  it("persiste en JSONL et reprend la chaîne à la réouverture", async () => {
    const path = tmpFile();
    let t = 5000;
    const store1 = new FileAuditStore(path, { now: () => t++ });
    await store1.append("round_open", { roundId: 1, serverSeedHash: "h1" });
    await store1.append("crash_revealed", { roundId: 1, crashPoint: 2.5 });

    // Réouverture indépendante sur le même fichier.
    const store2 = new FileAuditStore(path, { now: () => 9999 });
    expect(await store2.count()).toBe(2);
    expect((await store2.head())?.seq).toBe(1);

    const r2 = await store2.append("settlement", { roundId: 1 });
    expect(r2.seq).toBe(2);
    expect((await store2.verify()).ok).toBe(true);

    // Le fichier contient bien 3 lignes JSONL.
    const raw = await readFile(path, "utf8");
    expect(raw.trim().split("\n")).toHaveLength(3);
  });

  it("détecte une altération du fichier sur le disque", async () => {
    const path = tmpFile();
    const store = new FileAuditStore(path, { now: () => 1 });
    await store.append("round_open", { roundId: 1 });
    await store.append("bet_accepted", { roundId: 1, betId: "b", playerId: "p", amountCents: 4242 });
    expect((await store.verify()).ok).toBe(true);

    // Falsification directe du fichier (on garde l'ancien hash → incohérent).
    const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
    const rec = JSON.parse(lines[1]) as AuditRecord;
    rec.payload.amountCents = 999_999;
    lines[1] = JSON.stringify(rec);
    await writeFile(path, `${lines.join("\n")}\n`, "utf8");

    const v = await new FileAuditStore(path).verify();
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.brokenAt).toBe(1);
  });
});

describe("AuditLogger + replayAudit", () => {
  it("journalise un tour complet et rejoue l'équité + les règlements", async () => {
    const store = new MemoryAuditStore({ now: () => 1 });
    const logger = new AuditLogger(store, MATH);

    // Tour réel : graine → engagement → point de crash dérivé.
    const serverSeed = "a3f1b2c4d5e6";
    const clientSeed = "deep-diver:1";
    const nonce = 0;
    const serverSeedHash = commitServerSeed(serverSeed);
    const { crashPoint } = deriveCrashPoint(serverSeed, clientSeed, nonce, MATH.houseEdge, MATH.maxMultiplier);

    await logger.roundOpen(1, serverSeedHash, 1000, 9000);
    await logger.betAccepted(1, "A", "alice", 1000);
    await logger.cashout(1, "A", "alice", 2.0, 2000, 5000);
    await logger.crashRevealed(1, crashPoint, serverSeed, serverSeedHash, clientSeed, nonce);

    const settlement: RoundSettlement = {
      roundId: 1,
      crashPoint,
      totalStakedCents: 1000,
      totalPaidCents: 2000,
      instructions: [{ type: "credit", playerId: "alice", betId: "A", amountCents: 2000 }],
    };
    await logger.settlement(settlement);

    expect((await store.verify()).ok).toBe(true);

    const replay = replayAudit(await store.read());
    expect(replay.ok).toBe(true);
    expect(replay.fairnessChecked).toBe(1);
    expect(replay.settlementsChecked).toBe(1);
  });

  it("repère un point de crash truqué", async () => {
    const store = new MemoryAuditStore({ now: () => 1 });
    const logger = new AuditLogger(store, MATH);
    const serverSeed = "deadbeef";
    const clientSeed = "c";
    const serverSeedHash = commitServerSeed(serverSeed);
    const { crashPoint } = deriveCrashPoint(serverSeed, clientSeed, 0, MATH.houseEdge, MATH.maxMultiplier);

    // On enregistre un crashPoint FAUX (truqué).
    await logger.crashRevealed(1, crashPoint + 5, serverSeed, serverSeedHash, clientSeed, 0);
    const replay = replayAudit(await store.read());
    expect(replay.ok).toBe(false);
    expect(replay.failures[0].reason).toContain("point de crash");
  });

  it("repère un total de règlement incohérent", async () => {
    const store = new MemoryAuditStore({ now: () => 1 });
    const logger = new AuditLogger(store, MATH);
    await logger.settlement({
      roundId: 7,
      crashPoint: 3,
      totalStakedCents: 1000,
      totalPaidCents: 5000, // ne correspond pas aux crédits
      instructions: [{ type: "credit", playerId: "x", betId: "x1", amountCents: 2000 }],
    });
    const replay = replayAudit(await store.read());
    expect(replay.ok).toBe(false);
    expect(replay.failures[0].reason).toContain("total payé");
  });
});
