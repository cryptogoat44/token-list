/**
 * Chat du lobby — vrai chat multi-utilisateurs SANS backend à héberger.
 *
 * Le navigateur de chaque joueur se connecte directement à un service public
 * de pub/sub (ntfy.sh) : tout le monde sur le même « topic » voit les messages
 * des autres, en temps réel. Aucun serveur à maintenir.
 *
 * ⚠️ Salon PUBLIC et ÉPHÉMÈRE de démonstration : les messages transitent par un
 * service tiers public, ne sont pas modérés et peuvent être lus par quiconque
 * connaît le topic. À n'écrire que des messages anodins (cf. avertissement UI).
 *
 * Architecture : tout passe par l'interface `ChatTransport`, donc on peut
 * brancher un autre service (Supabase, Firebase, un WebSocket maison…) sans
 * toucher à l'UI. Repli automatique en mode local si le relais est injoignable.
 */

export type ChatStatus = "connecting" | "online" | "offline";

export interface ChatMessage {
  id: string;
  user: string;
  text: string;
  ts: number;
  /** Message envoyé par soi-même. */
  self?: boolean;
  /** Message d'animation locale (PNJ) ou message système. */
  bot?: boolean;
  system?: boolean;
}

/** Topic public du salon (modifiable). */
export const CHAT_TOPIC = "deep-diver-lobby-fr-v1";
/** Relais public utilisé (ntfy). */
export const NTFY_BASE = "https://ntfy.sh";
/** Active le vrai relais multi-joueurs (sinon salon local + animation). */
export const CHAT_RELAY_ENABLED = true;

const MAX_LEN = 240;
const BLOCKLIST = /\b(merde|connard|salope|encul\w*|put\w*|nique\w*)\b/gi;

/** Nettoie/borne un message avant envoi ou affichage. */
export function sanitizeChat(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LEN)
    .replace(BLOCKLIST, (m) => m[0] + "*".repeat(Math.max(1, m.length - 1)));
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

export interface ChatTransport {
  connect(onMessage: (m: ChatMessage) => void, onStatus: (s: ChatStatus) => void): void;
  send(message: ChatMessage): void;
  disconnect(): void;
}

/** Repli local : aucun message distant, juste l'écho de soi (+ animation). */
export class LocalChatTransport implements ChatTransport {
  connect(_onMessage: (m: ChatMessage) => void, onStatus: (s: ChatStatus) => void): void {
    onStatus("offline");
  }
  send(): void {
    /* l'UI ajoute déjà le message localement */
  }
  disconnect(): void {}
}

/** Relais public ntfy.sh : pub/sub temps réel, sans compte ni serveur. */
export class NtfyChatTransport implements ChatTransport {
  private ws: WebSocket | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private onMessage: (m: ChatMessage) => void = () => {};
  private onStatus: (s: ChatStatus) => void = () => {};

  constructor(private readonly topic: string = CHAT_TOPIC) {}

  connect(onMessage: (m: ChatMessage) => void, onStatus: (s: ChatStatus) => void): void {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.open();
  }

  private open(): void {
    this.onStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(`wss://ntfy.sh/${this.topic}/ws`);
    } catch {
      this.onStatus("offline");
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => this.onStatus("online");
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(typeof e.data === "string" ? e.data : "");
        if (data?.event !== "message" || typeof data.message !== "string") return;
        const parsed = parsePayload(data.message, typeof data.time === "number" ? data.time * 1000 : Date.now());
        if (parsed) this.onMessage(parsed);
      } catch {
        /* trame ignorée */
      }
    };
    ws.onclose = () => {
      this.onStatus("offline");
      if (!this.closed) this.scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnect) clearTimeout(this.reconnect);
    this.reconnect = setTimeout(() => this.open(), 5000);
  }

  send(message: ChatMessage): void {
    // Corps en text/plain (pas d'en-tête Content-Type) → requête « simple »,
    // donc pas de préflight CORS.
    void fetch(`${NTFY_BASE}/${this.topic}`, {
      method: "POST",
      body: JSON.stringify({ id: message.id, u: message.user, t: message.text }),
    }).catch(() => {
      /* hors-ligne : le message reste affiché localement */
    });
  }

  disconnect(): void {
    this.closed = true;
    if (this.reconnect) clearTimeout(this.reconnect);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

/** Décode le corps publié (JSON {id,u,t}) en message de chat. */
function parsePayload(raw: string, ts: number): ChatMessage | null {
  try {
    const o = JSON.parse(raw);
    if (typeof o?.t === "string") {
      const text = sanitizeChat(o.t);
      if (!text) return null;
      return {
        id: typeof o.id === "string" ? o.id : newId(),
        user: typeof o.u === "string" ? o.u.slice(0, 24) : "plongeur",
        text,
        ts,
      };
    }
  } catch {
    /* pas du JSON : message brut */
  }
  const text = sanitizeChat(raw);
  return text ? { id: newId(), user: "plongeur", text, ts } : null;
}

export function makeChatTransport(): ChatTransport {
  return CHAT_RELAY_ENABLED ? new NtfyChatTransport() : new LocalChatTransport();
}

// ─────────────────────────────────────────── animation locale du salon (PNJ)

const BOT_NAMES = [
  "Abys77", "CoralKing", "Manta_Fr", "Triton", "Sirena", "Marlin92", "Nautile",
  "Calypso", "BleuProfond", "ApnéeZen", "Narval", "Lagon", "Écume", "Poseidon",
  "RécifX", "Cachalot", "Mistral", "Espadon", "OndineFr", "Maelström",
];

const BOT_CHATTER = [
  "go go go 🤿", "j'attends un gros coup là", "respire… respire…",
  "trop tôt sorti 😤", "patience les plongeurs", "x2 et je sors",
  "qui tente l'abysse ?", "ça sent le gros tour", "jamais deux sans trois",
  "la dernière était cruelle", "je sens que ça va monter", "encaisse tôt, dors bien",
  "full sang-froid 🧊", "allez on y croit", "petite mise tranquille",
];
const BOT_ON_BIG = ["énorme 🐋", "GG le boss 🔱", "il a tenu jusqu'au bout 😮", "la descente de malade !", "j'aurais jamais osé", "👏👏👏"];
const BOT_ON_CRASH = ["rip 🪦", "syncope direct…", "aïe le 1.00x", "sorti à temps ouf", "ça pique", "remontée trop tard 😬"];

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

export function randomBotName(): string {
  return pick(BOT_NAMES);
}

export function makeBotMessage(kind: "idle" | "big" | "crash"): ChatMessage {
  const text =
    kind === "big" ? pick(BOT_ON_BIG) : kind === "crash" ? pick(BOT_ON_CRASH) : pick(BOT_CHATTER);
  return { id: newId(), user: randomBotName(), text, ts: Date.now(), bot: true };
}
