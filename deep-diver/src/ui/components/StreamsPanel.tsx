/**
 * Onglet « Lives » : liens vers des parties en direct sur Twitch / Kick, pour
 * suivre la communauté. Purement décoratif (liens externes), sans backend.
 */
import { memo } from "react";
import {
  FEATURED_STREAM,
  STREAM_CHANNELS,
  STREAM_DIRECTORIES,
  streamEmbedUrl,
  streamUrl,
  type StreamChannel,
} from "../streamsConfig";

function PlatformBadge({ platform }: { platform: StreamChannel["platform"] }) {
  const isTwitch = platform === "twitch";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        isTwitch ? "bg-[#9146FF]/25 text-[#c9b3ff]" : "bg-[#53FC18]/20 text-[#9bf57a]"
      }`}
    >
      {isTwitch ? "Twitch" : "Kick"}
    </span>
  );
}

export const StreamsPanel = memo(function StreamsPanel() {
  const parentHost =
    typeof window !== "undefined" ? window.location.hostname : "localhost";

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="rounded-lg border border-cyan-400/10 bg-slate-950/50 p-3 text-xs leading-relaxed text-slate-300">
        🎥 Regardez d'autres plongeurs en direct et suivez les parties ensemble.
        Liens vers des streams Twitch / Kick — purement communautaire.
      </p>

      {/* Lecteur intégré optionnel (si une chaîne « vedette » est configurée). */}
      {FEATURED_STREAM && (
        <div className="overflow-hidden rounded-xl border border-cyan-400/15 bg-black">
          <div className="aspect-video w-full">
            <iframe
              title={`Live de ${FEATURED_STREAM.label}`}
              src={streamEmbedUrl(FEATURED_STREAM, parentHost)}
              className="h-full w-full"
              allow="autoplay; fullscreen"
              allowFullScreen
            />
          </div>
        </div>
      )}

      {/* Catégories « en direct » toujours disponibles. */}
      <div className="flex flex-col gap-2">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Parties en direct
        </h4>
        {(["twitch", "kick"] as const).map((p) => (
          <a
            key={p}
            href={STREAM_DIRECTORIES[p].url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-lg border border-cyan-400/10 bg-slate-800/50 px-3 py-2.5 text-sm text-cyan-100 transition hover:border-cyan-400/40 hover:bg-slate-700/60 active:scale-[0.99]"
          >
            <span className="flex items-center gap-2">
              <PlatformBadge platform={p} />
              {STREAM_DIRECTORIES[p].label}
            </span>
            <span aria-hidden="true" className="text-cyan-400/70">
              ↗
            </span>
          </a>
        ))}
      </div>

      {/* Chaînes mises en avant par la communauté. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Chaînes de la communauté
        </h4>
        {STREAM_CHANNELS.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-600/50 bg-slate-950/40 p-3 text-xs text-slate-500">
            Aucune chaîne pour l'instant. Vous streamez Deep Diver ? Vos liens
            Twitch / Kick peuvent apparaître ici — il suffit de les ajouter à la
            configuration.
          </p>
        ) : (
          <ul className="space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
            {STREAM_CHANNELS.map((c) => (
              <li key={`${c.platform}:${c.channel}`}>
                <a
                  href={streamUrl(c)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-cyan-100 transition hover:bg-slate-700/60"
                >
                  <span className="flex items-center gap-2">
                    <PlatformBadge platform={c.platform} />
                    {c.label}
                  </span>
                  <span className="rounded bg-cyan-500/15 px-2 py-0.5 text-xs font-semibold text-cyan-300">
                    Regarder ↗
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});
