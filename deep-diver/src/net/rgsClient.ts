/**
 * Client WebSocket du Remote Game Server.
 *
 * Le serveur est la SEULE source de vérité ; ce client ne fait que :
 *  - recevoir l'état public poussé par le serveur (sans `crashAt` ni graine
 *    secrète avant le crash) ;
 *  - envoyer des INTENTIONS (place_bet, cashout) — c'est l'horodatage SERVEUR
 *    à la réception qui fait foi, jamais l'horloge locale ;
 *  - synchroniser une estimation de l'horloge serveur (pour l'affichage) ;
 *  - se reconnecter automatiquement (backoff exponentiel).
 *
 * Aucune logique de jeu ni d'argent ici : uniquement du transport.
 * La fabrique de socket est injectable pour pouvoir tester hors navigateur.
 */
import {
  encodeClientMessage,
  type PublicRoundState,
  type ServerMessage,
} from "@shared/protocol";

const WS_OPEN = 1;

export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

/** Sous-ensemble minimal de l'API WebSocket dont on dépend (testable). */
export interface MessageLike {
  data: unknown;
}
export type SocketEventType = "open" | "message" | "close" | "error";
/** Handler générique : reçoit l'événement message ; ignoré pour open/close/error. */
export type SocketEventHandler = (ev: MessageLike) => void;
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: SocketEventType, handler: SocketEventHandler): void;
}
export type SocketFactory = (url: string) => WebSocketLike;

/** Révélation d'un crash (graine dévoilée) — vérifiable côté client. */
export interface CrashReveal {
  roundId: number;
  crashPoint: number;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

/** Accusé de réception d'une intention (mise / encaissement). */
export interface AckEvent {
  kind: "bet" | "cashout";
  betId: string;
  ok: boolean;
  reason?: string;
  multiplier?: number;
  payoutCents?: number;
}

/** Instantané réactif exposé à l'UI. */
export interface RgsSnapshot {
  status: ConnectionStatus;
  /** Dernier état public reçu (null avant la 1re frame). */
  state: PublicRoundState | null;
  /** Dernière révélation de crash reçue (équité). */
  lastReveal: CrashReveal | null;
  /** Identité attribuée par le serveur. */
  playerId: string | null;
  /** Décalage (horloge serveur − horloge locale), en ms. */
  clockOffsetMs: number;
}

export interface RgsClientOptions {
  url: string;
  /** Pseudo transmis au serveur (?player=…). */
  player?: string;
  /** Fabrique de socket (défaut : WebSocket du navigateur). */
  socketFactory?: SocketFactory;
  /** Horloge locale (injectable pour les tests). */
  now?: () => number;
  /** Backoff de reconnexion. */
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  /** Planificateur (injectable pour les tests). */
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
}

function defaultFactory(url: string): WebSocketLike {
  // Cast volontaire : le WebSocket du DOM satisfait WebSocketLike à l'usage.
  return new WebSocket(url) as unknown as WebSocketLike;
}

let betCounter = 0;
/** Identifiant de mise unique côté client (idempotence côté serveur). */
export function newBetId(): string {
  betCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `b${Date.now().toString(36)}-${betCounter}-${rand}`;
}

export class RgsClient {
  private readonly url: string;
  private readonly player?: string;
  private readonly factory: SocketFactory;
  private readonly now: () => number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly setTimeoutFn: NonNullable<RgsClientOptions["setTimeoutFn"]>;
  private readonly clearTimeoutFn: NonNullable<RgsClientOptions["clearTimeoutFn"]>;

  private ws: WebSocketLike | null = null;
  private closedByUser = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private snap: RgsSnapshot = {
    status: "idle",
    state: null,
    lastReveal: null,
    playerId: null,
    clockOffsetMs: 0,
  };

  private readonly stateListeners = new Set<(s: RgsSnapshot) => void>();
  private readonly crashListeners = new Set<(r: CrashReveal) => void>();
  private readonly ackListeners = new Set<(a: AckEvent) => void>();

  constructor(opts: RgsClientOptions) {
    this.url = opts.url;
    this.player = opts.player;
    this.factory = opts.socketFactory ?? defaultFactory;
    this.now = opts.now ?? Date.now;
    this.reconnectBaseMs = opts.reconnectBaseMs ?? 800;
    this.reconnectMaxMs = opts.reconnectMaxMs ?? 15_000;
    this.setTimeoutFn = opts.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimeoutFn = opts.clearTimeoutFn ?? ((id) => clearTimeout(id));
  }

  /** Démarre la connexion (idempotent). */
  connect(): void {
    this.closedByUser = false;
    if (this.ws) return;
    this.open();
  }

  private fullUrl(): string {
    if (!this.player) return this.url;
    const sep = this.url.includes("?") ? "&" : "?";
    return `${this.url}${sep}player=${encodeURIComponent(this.player)}`;
  }

  private open(): void {
    this.patch({ status: this.attempt === 0 ? "connecting" : "reconnecting" });
    let ws: WebSocketLike;
    try {
      ws = this.factory(this.fullUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.attempt = 0;
      this.patch({ status: "open" });
    });
    ws.addEventListener("message", (ev) => this.onRaw(ev.data));
    ws.addEventListener("close", () => this.onClose());
    ws.addEventListener("error", () => {
      // 'close' suivra ; on ne fait rien de plus ici.
    });
  }

  private onClose(): void {
    this.ws = null;
    if (this.closedByUser) {
      this.patch({ status: "closed" });
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.patch({ status: "reconnecting" });
    const delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** this.attempt);
    this.attempt += 1;
    if (this.reconnectTimer) this.clearTimeoutFn(this.reconnectTimer);
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.open();
    }, delay);
  }

  private onRaw(data: unknown): void {
    const text = typeof data === "string" ? data : String(data);
    let msg: ServerMessage;
    try {
      msg = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }
    this.onMessage(msg);
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case "welcome":
        this.patch({ playerId: msg.playerId, clockOffsetMs: msg.serverTime - this.now() });
        break;
      case "state":
        this.patch({ state: msg.state, clockOffsetMs: msg.state.serverTime - this.now() });
        break;
      case "round_created":
        this.patch({ clockOffsetMs: msg.serverTime - this.now() });
        break;
      case "crashed": {
        const reveal: CrashReveal = {
          roundId: msg.roundId,
          crashPoint: msg.crashPoint,
          serverSeed: msg.serverSeed,
          serverSeedHash: msg.serverSeedHash,
          clientSeed: msg.clientSeed,
          nonce: msg.nonce,
        };
        this.patch({ lastReveal: reveal });
        this.crashListeners.forEach((l) => l(reveal));
        break;
      }
      case "bet_ack":
        this.emitAck({ kind: "bet", betId: msg.betId, ok: msg.ok, reason: msg.reason });
        break;
      case "cashout_ack":
        this.emitAck({
          kind: "cashout",
          betId: msg.betId,
          ok: msg.ok,
          reason: msg.reason,
          multiplier: msg.multiplier,
          payoutCents: msg.payoutCents,
        });
        break;
      case "error":
        // Erreur protocole : ignorée silencieusement côté affichage.
        break;
    }
  }

  private emitAck(a: AckEvent): void {
    this.ackListeners.forEach((l) => l(a));
  }

  /** Envoie l'intention de miser. Renvoie le betId (ou null si non connecté). */
  placeBet(amountCents: number): string | null {
    const betId = newBetId();
    return this.sendIntent({ t: "place_bet", betId, amountCents }) ? betId : null;
  }

  /** Envoie l'intention d'encaisser une mise donnée. */
  cashout(betId: string): boolean {
    return this.sendIntent({ t: "cashout", betId });
  }

  private sendIntent(msg: Parameters<typeof encodeClientMessage>[0]): boolean {
    if (!this.ws || this.ws.readyState !== WS_OPEN) return false;
    try {
      this.ws.send(encodeClientMessage(msg));
      return true;
    } catch {
      return false;
    }
  }

  /** Estimation de l'horloge serveur courante. */
  serverNow(): number {
    return this.now() + this.snap.clockOffsetMs;
  }

  getSnapshot(): RgsSnapshot {
    return this.snap;
  }

  subscribe(listener: (s: RgsSnapshot) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.snap);
    return () => this.stateListeners.delete(listener);
  }

  onCrash(listener: (r: CrashReveal) => void): () => void {
    this.crashListeners.add(listener);
    return () => this.crashListeners.delete(listener);
  }

  onAck(listener: (a: AckEvent) => void): () => void {
    this.ackListeners.add(listener);
    return () => this.ackListeners.delete(listener);
  }

  /** Ferme volontairement la connexion (pas de reconnexion). */
  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      this.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.patch({ status: "closed" });
  }

  private patch(p: Partial<RgsSnapshot>): void {
    this.snap = { ...this.snap, ...p };
    this.stateListeners.forEach((l) => l(this.snap));
  }
}
