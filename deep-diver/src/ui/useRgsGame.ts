/**
 * Pont React ↔ Remote Game Server.
 *
 * Crée un `RgsClient` unique, le connecte, et expose un instantané réactif +
 * les actions (miser / encaisser). Aucune logique de jeu côté client : tout
 * vient du serveur (source de vérité).
 */
import { useEffect, useRef, useState } from "react";
import {
  RgsClient,
  type AckEvent,
  type CrashReveal,
  type RgsSnapshot,
} from "../net/rgsClient";

export interface UseRgsGameResult {
  snapshot: RgsSnapshot;
  /** Envoie une intention de mise ; renvoie le betId (ou null si non connecté). */
  placeBet: (amountCents: number) => string | null;
  /** Envoie une intention d'encaissement. */
  cashout: (betId: string) => boolean;
  /** Abonne un écouteur d'accusés de réception (mise / encaissement). */
  onAck: (listener: (a: AckEvent) => void) => () => void;
  /** Abonne un écouteur de révélations de crash (équité). */
  onCrash: (listener: (r: CrashReveal) => void) => () => void;
  /** Estimation de l'horloge serveur (ms). */
  serverNow: () => number;
}

export function useRgsGame(url: string, player?: string): UseRgsGameResult {
  const clientRef = useRef<RgsClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new RgsClient({ url, player });
  }
  const client = clientRef.current;

  const [snapshot, setSnapshot] = useState<RgsSnapshot>(() => client.getSnapshot());

  useEffect(() => {
    const unsub = client.subscribe(setSnapshot);
    client.connect();
    return () => {
      unsub();
      client.close();
    };
  }, [client]);

  return {
    snapshot,
    placeBet: (cents) => client.placeBet(cents),
    cashout: (betId) => client.cashout(betId),
    onAck: (l) => client.onAck(l),
    onCrash: (l) => client.onCrash(l),
    serverNow: () => client.serverNow(),
  };
}
