/**
 * Accueil des nouveaux : explique la mécanique en douceur (miser → descendre →
 * remonter), pose la règle de la syncope, et rappelle l'honnêteté (argent
 * fictif, RTP 97 %, imprévisibilité). Généreux en explications, sans pression.
 * S'affiche à la première visite et reste rejouable via le bouton « ? ».
 */
interface Props {
  onClose: () => void;
}

const STEPS = [
  {
    icon: "🪙",
    title: "1. Prépare ta plongée",
    text: "Pendant la fenêtre de pari, choisis ta mise (en crédits fictifs) et valide. Le plongeur prend une grande inspiration.",
  },
  {
    icon: "🤿",
    title: "2. Descends",
    text: "Le plongeur descend : plus il va profond, plus le multiplicateur grimpe. Le gain potentiel augmente avec la profondeur.",
  },
  {
    icon: "🌊",
    title: "3. Remonte à temps",
    text: "Clique « Remonter » pour encaisser mise × multiplicateur. Mais à un instant imprévisible, le plongeur fait une syncope : si tu n'es pas remonté, la mise est perdue.",
  },
];

export function Onboarding({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Bienvenue dans Deep Diver"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-cyan-400/20 bg-slate-900 shadow-2xl">
        <header className="border-b border-white/5 px-5 py-4 text-center">
          <h2 className="text-2xl font-black tracking-tight">
            <span aria-hidden="true">🤿</span>{" "}
            <span className="bg-gradient-to-r from-cyan-300 to-blue-500 bg-clip-text text-transparent">
              Bienvenue, plongeur
            </span>
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Un jeu de plongée en apnée — en <strong className="text-amber-300">argent fictif</strong>, juste pour le plaisir.
          </p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5 [scrollbar-width:thin]">
          {STEPS.map((s) => (
            <div key={s.title} className="flex items-start gap-3 rounded-xl border border-cyan-400/10 bg-slate-950/50 p-3">
              <span className="text-2xl" aria-hidden="true">{s.icon}</span>
              <span>
                <span className="block text-sm font-bold text-cyan-100">{s.title}</span>
                <span className="block text-xs leading-relaxed text-slate-400">{s.text}</span>
              </span>
            </div>
          ))}
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-3 text-xs leading-relaxed text-emerald-200/90">
            <p>
              <strong>Ton seul vrai levier, c'est QUAND remonter</strong> : tôt = sûr mais petit,
              tard = plus gros mais plus risqué.
            </p>
            <p className="mt-1 text-slate-400">
              Le jeu est <strong className="text-slate-300">équitable et vérifiable</strong> (RTP
              97 %), mais <strong className="text-slate-300">personne ne peut prédire</strong> la
              prochaine syncope. Sur la durée, l'avantage maison (3 %) fait perdre en moyenne — c'est
              une démo, on joue pour s'amuser.
            </p>
          </div>
        </div>

        <footer className="border-t border-white/5 p-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-extrabold uppercase tracking-wide text-slate-950 transition hover:bg-cyan-400 active:scale-[0.98]"
          >
            C'est parti 🫧
          </button>
          <p className="mt-2 text-center text-[10px] text-slate-500">
            Tu pourras revoir ces explications via le bouton « ? » en haut.
          </p>
        </footer>
      </div>
    </div>
  );
}
