/**
 * Configuration des « lives » (Twitch / Kick) affichés dans l'onglet Lives.
 *
 * ⚙️ PERSONNALISABLE — ajoutez dans STREAM_CHANNELS les chaînes de la
 * communauté que vous voulez mettre en avant (celles de joueurs qui streament
 * Deep Diver). Tout est purement décoratif : ce sont de simples liens externes.
 */
export type StreamPlatform = "twitch" | "kick";

export interface StreamChannel {
  platform: StreamPlatform;
  /** Identifiant de la chaîne tel qu'il apparaît dans l'URL. */
  channel: string;
  /** Nom affiché. */
  label: string;
}

/**
 * Chaînes mises en avant. Vide par défaut : renseignez ici vos chaînes, p.ex.
 *   { platform: "kick", channel: "ma-chaine", label: "Ma chaîne" }
 */
export const STREAM_CHANNELS: StreamChannel[] = [];

/**
 * Si vous voulez intégrer directement un lecteur vidéo dans la page, mettez ici
 * la chaîne à afficher en grand (sinon laissez null pour n'avoir que des liens).
 */
export const FEATURED_STREAM: StreamChannel | null = null;

/** Catégories « parties en direct » toujours pertinentes, sans backend. */
export const STREAM_DIRECTORIES: Record<StreamPlatform, { url: string; label: string }> = {
  twitch: {
    url: "https://www.twitch.tv/directory/category/slots",
    label: "Twitch — Slots & Casino en direct",
  },
  kick: {
    url: "https://kick.com/categories/slots",
    label: "Kick — Slots en direct",
  },
};

export function streamUrl(c: StreamChannel): string {
  return c.platform === "twitch"
    ? `https://www.twitch.tv/${c.channel}`
    : `https://kick.com/${c.channel}`;
}

/** URL d'intégration (iframe) du lecteur, avec le domaine parent requis. */
export function streamEmbedUrl(c: StreamChannel, parentHost: string): string {
  return c.platform === "twitch"
    ? `https://player.twitch.tv/?channel=${encodeURIComponent(c.channel)}&parent=${encodeURIComponent(parentHost)}&muted=true`
    : `https://player.kick.com/${encodeURIComponent(c.channel)}`;
}
