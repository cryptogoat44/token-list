/**
 * Journal d'audit sur FICHIER (JSONL : un enregistrement scellé par ligne).
 *
 * Append-only et chaîné par hash. Persistant entre redémarrages : à
 * l'ouverture, on relit le fichier pour reprendre la chaîne là où elle s'est
 * arrêtée. `verify()` relit le DISQUE (source de vérité) afin de détecter toute
 * altération externe du fichier. Aucune dépendance hors `node:` standard.
 *
 * Implémente la même interface `AuditStore` qu'en mémoire : un futur adaptateur
 * PostgreSQL se substitue sans changer le reste du serveur.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { GENESIS_HASH, makeRecord, verifyChain } from "./hashChain";
import type { AuditEventType, AuditPayload, AuditRecord, AuditStore, VerifyResult } from "./types";

export class FileAuditStore implements AuditStore {
  private readonly filePath: string;
  private readonly now: () => number;
  private mirror: AuditRecord[] = [];
  private loaded = false;
  private lock: Promise<void> = Promise.resolve();

  constructor(filePath: string, opts: { now?: () => number } = {}) {
    this.filePath = filePath;
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

  private async readLines(): Promise<AuditRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as AuditRecord);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.mirror = await this.readLines();
    this.loaded = true;
  }

  append(type: AuditEventType, payload: AuditPayload): Promise<AuditRecord> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const seq = this.mirror.length;
      const prevHash = seq === 0 ? GENESIS_HASH : this.mirror[seq - 1].hash;
      const rec = makeRecord(seq, prevHash, type, payload, this.now());
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(rec)}\n`, "utf8");
      this.mirror.push(rec);
      return rec;
    });
  }

  async head(): Promise<AuditRecord | null> {
    await this.ensureLoaded();
    return this.mirror.length ? this.mirror[this.mirror.length - 1] : null;
  }

  async read(opts: { fromSeq?: number; toSeq?: number } = {}): Promise<AuditRecord[]> {
    await this.ensureLoaded();
    const from = opts.fromSeq ?? 0;
    const to = opts.toSeq ?? this.mirror.length - 1;
    return this.mirror.filter((r) => r.seq >= from && r.seq <= to).map((r) => ({ ...r }));
  }

  async count(): Promise<number> {
    await this.ensureLoaded();
    return this.mirror.length;
  }

  /** Vérifie depuis le DISQUE (détecte une altération du fichier hors process). */
  async verify(): Promise<VerifyResult> {
    const onDisk = await this.readLines();
    return verifyChain(onDisk);
  }
}
