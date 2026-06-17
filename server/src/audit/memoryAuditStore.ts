/**
 * Journal d'audit EN MÉMOIRE (tests, démo). Append-only, chaîné par hash.
 * Les écritures sont sérialisées pour garantir un chaînage cohérent.
 */
import { GENESIS_HASH, makeRecord, verifyChain } from "./hashChain";
import type { AuditEventType, AuditPayload, AuditRecord, AuditStore, VerifyResult } from "./types";

export class MemoryAuditStore implements AuditStore {
  private readonly records: AuditRecord[] = [];
  private readonly now: () => number;
  private lock: Promise<void> = Promise.resolve();

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
  }

  private runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.lock.then(fn);
    this.lock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  append(type: AuditEventType, payload: AuditPayload): Promise<AuditRecord> {
    return this.runExclusive(() => {
      const seq = this.records.length;
      const prevHash = seq === 0 ? GENESIS_HASH : this.records[seq - 1].hash;
      const rec = makeRecord(seq, prevHash, type, payload, this.now());
      this.records.push(rec);
      return rec;
    });
  }

  async head(): Promise<AuditRecord | null> {
    return this.records.length ? this.records[this.records.length - 1] : null;
  }

  async read(opts: { fromSeq?: number; toSeq?: number } = {}): Promise<AuditRecord[]> {
    const from = opts.fromSeq ?? 0;
    const to = opts.toSeq ?? this.records.length - 1;
    return this.records.filter((r) => r.seq >= from && r.seq <= to).map((r) => ({ ...r }));
  }

  async count(): Promise<number> {
    return this.records.length;
  }

  async verify(): Promise<VerifyResult> {
    return verifyChain(this.records);
  }
}
