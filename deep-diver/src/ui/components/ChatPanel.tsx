/**
 * Salon de discussion du lobby. Vrai chat multi-joueurs via un relais public
 * (voir sim/chat.ts), animé localement par quelques PNJ pour ne jamais paraître
 * vide. Sécurité : rendu en texte (échappé par React), longueur bornée, anti-
 * spam basique, masquage léger d'insultes, avertissement « salon public ».
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CHAT_RELAY_ENABLED,
  makeBotMessage,
  makeChatTransport,
  newId,
  sanitizeChat,
  type ChatMessage,
  type ChatStatus,
} from "../../sim/chat";

interface Props {
  /** Identifiant du tour courant (déclenche l'animation des PNJ). */
  roundId: number;
  /** Dernier point de crash connu (réactions des PNJ). */
  lastCrashPoint: number | null;
}

const PSEUDO_KEY = "deepdiver.pseudo";
const SEND_COOLDOWN_MS = 1500;
const MAX_MESSAGES = 120;

function loadPseudo(): string {
  try {
    const p = localStorage.getItem(PSEUDO_KEY);
    if (p && p.trim()) return p.slice(0, 24);
  } catch {
    /* ignore */
  }
  return `Plongeur${Math.floor(100 + Math.random() * 900)}`;
}

const statusLabel: Record<ChatStatus, string> = {
  connecting: "connexion…",
  online: "en ligne",
  offline: CHAT_RELAY_ENABLED ? "hors-ligne (local)" : "salon local",
};
const statusColor: Record<ChatStatus, string> = {
  connecting: "bg-amber-400",
  online: "bg-emerald-400",
  offline: "bg-slate-500",
};

export function ChatPanel({ roundId, lastCrashPoint }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("connecting");
  const [pseudo, setPseudo] = useState<string>(() => loadPseudo());
  const [draft, setDraft] = useState("");
  const [cooldownHint, setCooldownHint] = useState(false);

  const transport = useMemo(() => makeChatTransport(), []);
  const sentIds = useRef<Set<string>>(new Set());
  const seenIds = useRef<Set<string>>(new Set());
  const lastSendAt = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const addMessage = useRef((m: ChatMessage) => {
    if (seenIds.current.has(m.id)) return;
    seenIds.current.add(m.id);
    setMessages((list) => {
      const next = [...list, m];
      return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
    });
  }).current;

  // Connexion au relais + message de bienvenue + amorce d'ambiance.
  useEffect(() => {
    addMessage({
      id: newId(),
      user: "système",
      text:
        "Bienvenue dans le salon du lobby 🤿 Discutez avec les autres plongeurs ! Salon public de démonstration : messages éphémères et non modérés.",
      ts: Date.now(),
      system: true,
    });
    transport.connect(
      (m) => {
        if (sentIds.current.has(m.id)) return; // écho de mon propre message
        addMessage(m);
      },
      (s) => setStatus(s),
    );
    // Quelques PNJ déjà présents.
    for (let i = 0; i < 2; i++) {
      setTimeout(() => addMessage(makeBotMessage("idle")), 800 + i * 1400);
    }
    return () => transport.disconnect();
  }, [transport, addMessage]);

  // Animation : bavardage régulier des PNJ.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      addMessage(makeBotMessage("idle"));
      timer = setTimeout(loop, 12000 + Math.random() * 16000);
    };
    timer = setTimeout(loop, 9000 + Math.random() * 10000);
    return () => clearTimeout(timer);
  }, [addMessage]);

  // Réactions des PNJ aux résultats marquants.
  useEffect(() => {
    if (lastCrashPoint === null) return;
    const big = lastCrashPoint >= 10;
    const bad = lastCrashPoint < 1.2;
    if ((big || bad) && Math.random() < 0.7) {
      const n = 1 + (Math.random() < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        setTimeout(
          () => addMessage(makeBotMessage(big ? "big" : "crash")),
          400 + Math.random() * 1800,
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  // Défilement automatique si on est déjà près du bas.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    if (nearBottom) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const persistPseudo = (value: string) => {
    const clean = value.slice(0, 24);
    setPseudo(clean);
    try {
      localStorage.setItem(PSEUDO_KEY, clean);
    } catch {
      /* ignore */
    }
  };

  const send = () => {
    const text = sanitizeChat(draft);
    if (!text) return;
    const now = Date.now();
    if (now - lastSendAt.current < SEND_COOLDOWN_MS) {
      setCooldownHint(true);
      setTimeout(() => setCooldownHint(false), 1200);
      return;
    }
    lastSendAt.current = now;
    const user = pseudo.trim() || "Plongeur";
    const msg: ChatMessage = { id: newId(), user, text, ts: now, self: true };
    sentIds.current.add(msg.id);
    addMessage(msg);
    transport.send(msg);
    setDraft("");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-slate-400">
          <span className={`inline-block h-2 w-2 rounded-full ${statusColor[status]}`} />
          Salon du lobby · {statusLabel[status]}
        </span>
      </div>

      <p className="mb-2 rounded-md bg-amber-500/5 px-2 py-1 text-[10px] leading-snug text-amber-200/70">
        ⚠️ Salon public de démonstration : messages éphémères, non modérés et
        visibles par tous. N'écrivez rien de personnel. 🪙 Argent fictif.
      </p>

      <div
        ref={listRef}
        className="flex-1 space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin]"
        aria-label="Messages du salon"
        aria-live="polite"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-lg px-2.5 py-1.5 text-xs ${
              m.system
                ? "bg-slate-800/40 italic text-slate-400"
                : m.self
                  ? "bg-cyan-500/10 text-cyan-100"
                  : m.bot
                    ? "bg-slate-800/40 text-slate-300"
                    : "bg-slate-800/60 text-slate-200"
            }`}
          >
            {!m.system && (
              <span
                className={`mr-1 font-semibold ${
                  m.self ? "text-cyan-300" : m.bot ? "text-slate-400" : "text-emerald-300"
                }`}
              >
                {m.self ? "vous" : m.user} :
              </span>
            )}
            <span className="break-words">{m.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <label className="sr-only" htmlFor="chat-pseudo">
          Votre pseudo
        </label>
        <input
          id="chat-pseudo"
          value={pseudo}
          onChange={(e) => persistPseudo(e.target.value)}
          maxLength={24}
          title="Votre pseudo"
          className="w-24 shrink-0 rounded-lg border border-cyan-400/20 bg-slate-950/70 px-2 py-1.5 text-xs text-cyan-100 outline-none focus:border-cyan-400/60"
        />
        <label className="sr-only" htmlFor="chat-input">
          Message
        </label>
        <input
          id="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          maxLength={240}
          placeholder="Écrire un message…"
          className="min-w-0 flex-1 rounded-lg border border-cyan-400/20 bg-slate-950/70 px-2.5 py-1.5 text-xs text-cyan-50 outline-none focus:border-cyan-400/60"
        />
        <button
          type="button"
          onClick={send}
          className="shrink-0 rounded-lg bg-cyan-500/20 px-3 py-1.5 text-xs font-bold text-cyan-300 transition hover:bg-cyan-500/30 active:scale-95"
        >
          Envoyer
        </button>
      </div>
      {cooldownHint && (
        <p className="mt-1 text-[10px] text-amber-300">Doucement… un message à la fois.</p>
      )}
    </div>
  );
}
