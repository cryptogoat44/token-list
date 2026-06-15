/**
 * Carnet du plongeur — fenêtre de profil : records de toujours, carnet de
 * plongée, succès débloqués, et apparence (cosmétiques). Tout est gratifiant et
 * non monétisé ; rien n'influe sur les probabilités ou l'économie.
 */
import { useState } from "react";
import { ACHIEVEMENTS } from "../../engine/achievements";
import { COSMETICS, type CosmeticSlot } from "../../engine/cosmetics";
import type { PlayerProfile } from "../../engine/profile";
import type { UseProfileResult } from "../useProfile";
import { formatCredits, formatDepth, formatMultiplier } from "../format";

interface Props {
  api: UseProfileResult;
  onClose: () => void;
}

type Section = "carnet" | "succes" | "apparence";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-cyan-400/10 bg-slate-950/50 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 font-mono text-base font-bold text-cyan-100">{value}</p>
    </div>
  );
}

export function ProfileModal({ api, onClose }: Props) {
  const { profile } = api;
  const [section, setSection] = useState<Section>("carnet");
  const [nameDraft, setNameDraft] = useState(profile.diverName);

  const tab = (id: Section, label: string) => (
    <button
      type="button"
      onClick={() => setSection(id)}
      className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
        section === id ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400 hover:bg-slate-800/80"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Carnet du plongeur"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-cyan-400/20 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <h2 className="flex items-center gap-2 text-lg font-bold text-cyan-100">
            <span aria-hidden="true">📖</span> Carnet du plongeur
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
          >
            ✕
          </button>
        </header>

        {/* Nom du plongeur */}
        <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2.5">
          <label htmlFor="diver-name" className="text-xs text-slate-400">
            Plongeur
          </label>
          <input
            id="diver-name"
            value={nameDraft}
            maxLength={24}
            placeholder="Votre nom de plongeur"
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => api.setDiverName(nameDraft)}
            className="flex-1 rounded-lg border border-cyan-400/20 bg-slate-950/70 px-2.5 py-1.5 text-sm text-cyan-50 outline-none focus:border-cyan-400/60"
          />
        </div>

        <div className="flex gap-1 px-4 pt-3">
          {tab("carnet", "Records")}
          {tab("succes", "Succès")}
          {tab("apparence", "Apparence")}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:thin]">
          {section === "carnet" && <CarnetSection profile={profile} />}
          {section === "succes" && <SuccesSection profile={profile} />}
          {section === "apparence" && <ApparenceSection api={api} />}
        </div>
      </div>
    </div>
  );
}

function CarnetSection({ profile }: { profile: PlayerProfile }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-cyan-200/70">
          Records de toujours
        </h3>
        <dl className="grid grid-cols-2 gap-2">
          <Stat label="Profondeur record" value={profile.bestDepthMeters > 0 ? formatDepth(profile.bestDepthMeters) : "—"} />
          <Stat label="Meilleur multiplicateur" value={profile.bestCashoutX > 0 ? formatMultiplier(profile.bestCashoutX) : "—"} />
          <Stat label="Plus gros gain" value={profile.bestWinCents > 0 ? `+${formatCredits(profile.bestWinCents)}` : "—"} />
          <Stat label="Plus longue série de remontées" value={String(profile.longestCashoutStreak)} />
          <Stat label="Plongées totales" value={String(profile.totalDives)} />
          <Stat label="Remontées réussies" value={String(profile.totalCashouts)} />
        </dl>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Ton seul vrai levier, c'est <strong className="text-slate-300">QUAND remonter</strong> :
          remonter tôt = sûr mais petit, attendre = plus gros mais plus risqué. Aucune
          stratégie ne prédit la syncope.
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-cyan-200/70">
          Plongées marquantes
        </h3>
        {profile.diveLog.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-600/50 bg-slate-950/40 p-3 text-xs text-slate-500">
            Tes belles remontées et tes records apparaîtront ici.
          </p>
        ) : (
          <ul className="space-y-1">
            {profile.diveLog.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-slate-800/50 px-2.5 py-1.5 text-xs"
              >
                <span className="font-mono font-bold text-cyan-200">{formatMultiplier(d.multiplier)}</span>
                <span className="text-slate-400">{formatDepth(d.depthMeters)}</span>
                <span className={`font-mono ${d.netCents >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                  {d.netCents >= 0 ? "+" : "−"}
                  {formatCredits(Math.abs(d.netCents))}
                </span>
                <span className="hidden text-slate-500 sm:inline">
                  {new Date(d.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SuccesSection({ profile }: { profile: PlayerProfile }) {
  const unlocked = new Set(profile.unlockedAchievements);
  const count = unlocked.size;
  return (
    <div>
      <p className="mb-3 text-xs text-slate-400">
        {count} / {ACHIEVEMENTS.length} succès débloqués — purement cosmétiques.
      </p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ACHIEVEMENTS.map((a) => {
          const got = unlocked.has(a.id);
          return (
            <li
              key={a.id}
              className={`flex items-start gap-2 rounded-xl border p-2.5 ${
                got
                  ? "border-emerald-400/30 bg-emerald-500/10"
                  : "border-slate-700/50 bg-slate-950/40 opacity-60"
              }`}
            >
              <span className={`text-xl ${got ? "" : "grayscale"}`} aria-hidden="true">
                {got ? a.icon : "🔒"}
              </span>
              <span>
                <span className={`block text-xs font-bold ${got ? "text-emerald-200" : "text-slate-400"}`}>
                  {a.name}
                </span>
                <span className="block text-[11px] text-slate-500">{a.description}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ApparenceSection({ api }: { api: UseProfileResult }) {
  const { profile } = api;
  const unlocked = new Set(profile.unlockedCosmetics);
  const slots: { slot: CosmeticSlot; label: string }[] = [
    { slot: "suit", label: "Combinaison" },
    { slot: "trail", label: "Traînée de bulles" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-slate-500">
        Cosmétiques débloqués par tes succès. Purement esthétique : aucun effet sur les
        gains ou les probabilités.
      </p>
      {slots.map(({ slot, label }) => (
        <div key={slot}>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-cyan-200/70">{label}</h3>
          <div className="flex flex-wrap gap-2">
            {COSMETICS.filter((c) => c.slot === slot).map((c) => {
              const got = unlocked.has(c.id);
              const selected = profile.selectedCosmetics[slot] === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!got}
                  onClick={() => api.pickCosmetic(slot, c.id)}
                  title={got ? c.name : `${c.name} — à débloquer`}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                    selected
                      ? "border-cyan-400/70 bg-cyan-500/15 text-cyan-100"
                      : got
                        ? "border-white/10 bg-slate-800/60 text-slate-200 hover:border-cyan-400/40"
                        : "cursor-not-allowed border-slate-700/50 bg-slate-950/40 text-slate-600"
                  }`}
                >
                  <span
                    className="inline-block h-4 w-4 rounded-full ring-1 ring-white/20"
                    style={{ background: c.color }}
                  />
                  {got ? c.name : "🔒"}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
