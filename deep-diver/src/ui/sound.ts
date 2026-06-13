/**
 * Sons synthétisés à la volée via Web Audio API — aucun fichier audio.
 *
 * Conception sonore (demande : immersion apnée) :
 *  - Fond très discret : nappe sous-marine grave (juste de l'atmosphère).
 *  - Phase BETTING (« prise d'air ») : le plongeur enchaîne de grandes
 *    inspirations, puis une DERNIÈRE très grande inspiration juste avant de
 *    plonger (startBreathing).
 *  - Phase DIVING (« apnée ») : souffle retenu — contractions du diaphragme
 *    (thumps graves rythmés) et tension de la glotte (craquements serrés) qui
 *    s'accélèrent et se tendent à mesure que la profondeur augmente
 *    (startBreathHold / updateBreathHold).
 * Tout est généré par filtrage de bruit + oscillateurs : pas d'assets.
 */

export class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private whiteBuf: AudioBuffer | null = null;
  private ambientNodes: AudioNode[] = [];

  /**
   * Échantillons audio RÉELS optionnels. S'ils sont déposés dans
   * `public/audio/` (voir public/audio/README.md), ils sont chargés au
   * démarrage et remplacent la synthèse correspondante — sinon on synthétise.
   */
  private samples: Record<string, AudioBuffer> = {};
  private holdBedSrc: AudioBufferSourceNode | null = null;

  // Respiration (prise d'air) : minuteurs programmés à annuler au besoin.
  private breathTimers: ReturnType<typeof setTimeout>[] = [];

  // Apnée (souffle retenu) sous l'eau.
  private holdActive = false;
  private holdMultiplier = 1;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private holdNodes: AudioNode[] = [];
  private holdDroneFilter: BiquadFilterNode | null = null;
  private holdDroneOsc: OscillatorNode | null = null;

  private _muted: boolean;

  constructor(muted = false) {
    this._muted = muted;
  }

  get muted(): boolean {
    return this._muted;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
    }
  }

  /** À appeler depuis un geste utilisateur (politique d'autoplay). */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this._muted ? 0 : 0.6;
    this.master.connect(this.ctx.destination);
    this.whiteBuf = this.makeWhiteNoise(2);
    this.startAmbient();
    void this.loadSamples();
  }

  /** Noms des échantillons réels optionnels (public/audio/<nom>.mp3). */
  private static readonly SAMPLE_NAMES = [
    "inhale",
    "exhale",
    "final-inhale",
    "breath-hold",
    "gasp",
    "relief",
  ];

  /** Charge les échantillons réels s'ils existent (sinon repli synthèse). */
  private async loadSamples(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const base = import.meta.env.BASE_URL || "./";
    await Promise.all(
      SoundManager.SAMPLE_NAMES.map(async (name) => {
        try {
          const res = await fetch(`${base}audio/${name}.mp3`);
          if (!res.ok) return;
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.samples[name] = buf;
        } catch {
          /* pas de fichier / format invalide : on synthétisera */
        }
      }),
    );
  }

  /** Joue un échantillon réel (renvoie la source pour les boucles), ou null. */
  private playSample(
    name: string,
    gainValue: number,
    loop = false,
    rate = 1,
  ): AudioBufferSourceNode | null {
    const ctx = this.ctx;
    const buf = this.samples[name];
    if (!ctx || !this.master || !buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gainValue;
    src.connect(g).connect(this.master);
    src.start();
    if (!loop) src.stop(ctx.currentTime + buf.duration / rate + 0.05);
    return src;
  }

  /** Tampon de bruit blanc réutilisable (souffles, spasmes). */
  private makeWhiteNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Nappe d'ambiance sous-marine, très basse et faible (juste un lit sonore). */
  private startAmbient(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; // bruit brun
      data[i] = last * 3;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 160;
    const gain = ctx.createGain();
    gain.gain.value = 0.05; // discret : le souffle doit primer
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.ambientNodes = [src, filter, gain];
  }

  // ───────────────────────────────────────────────────────── respiration

  /**
   * Un souffle (inspiration ou expiration), façonné par filtrage de bruit.
   * Inspiration : le filtre balaie vers l'aigu (l'air entre, le souffle
   * « s'ouvre »), montée progressive. Expiration : balayage vers le grave.
   */
  private breath(opts: {
    dur: number;
    peak: number;
    fStart: number;
    fEnd: number;
    attackRatio: number;
    q?: number;
  }): void {
    if (!this.ctx || !this.master || !this.whiteBuf) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteBuf;
    src.loop = true;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = opts.q ?? 0.7;
    bp.frequency.setValueAtTime(opts.fStart, t0);
    bp.frequency.exponentialRampToValueAtTime(Math.max(40, opts.fEnd), t0 + opts.dur);

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 170;

    // Formant « gorge/poitrine » : donne un grain plus corporel au souffle.
    const formant = ctx.createBiquadFilter();
    formant.type = "peaking";
    formant.frequency.value = 850;
    formant.Q.value = 1.1;
    formant.gain.value = 6;

    const g = ctx.createGain();
    const peakAt = t0 + opts.dur * opts.attackRatio;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.peak, peakAt);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);

    src.connect(bp).connect(hp).connect(formant).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.05);
  }

  /**
   * Composante « voisée » (cordes vocales) façon « haaa » : superposée au
   * souffle de bruit, elle le rend nettement plus humain. Volume volontairement
   * faible (le souffle reste dominant).
   */
  private voiced(opts: { dur: number; f0: number; peak: number }): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(opts.f0 * 0.95, t0);
    osc.frequency.linearRampToValueAtTime(opts.f0 * 1.08, t0 + opts.dur);
    // Deux formants → voyelle ouverte « ha ».
    const f1 = ctx.createBiquadFilter();
    f1.type = "bandpass";
    f1.frequency.value = 720;
    f1.Q.value = 4;
    const f2 = ctx.createBiquadFilter();
    f2.type = "bandpass";
    f2.frequency.value = 1150;
    f2.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.peak, t0 + opts.dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    // Léger vibrato : grain organique.
    const vib = ctx.createOscillator();
    vib.frequency.value = 5 + Math.random() * 2;
    const vibG = ctx.createGain();
    vibG.gain.value = opts.f0 * 0.02;
    vib.connect(vibG).connect(osc.frequency);
    osc.connect(f1).connect(g).connect(this.master);
    osc.connect(f2).connect(g);
    osc.start(t0);
    vib.start(t0);
    osc.stop(t0 + opts.dur + 0.05);
    vib.stop(t0 + opts.dur + 0.05);
  }

  private inhale(big = false): void {
    // Échantillon réel si disponible, sinon synthèse + voix.
    if (this.playSample(big ? "final-inhale" : "inhale", big ? 0.9 : 0.7)) return;
    this.breath(
      big
        ? { dur: 1.9, peak: 0.42, fStart: 240, fEnd: 1500, attackRatio: 0.82, q: 0.6 }
        : { dur: 1.15, peak: 0.22, fStart: 340, fEnd: 1050, attackRatio: 0.72 },
    );
    this.voiced(big ? { dur: 1.6, f0: 145, peak: 0.07 } : { dur: 1.0, f0: 165, peak: 0.035 });
  }

  private exhale(): void {
    if (this.playSample("exhale", 0.6)) return;
    this.breath({ dur: 1.0, peak: 0.16, fStart: 900, fEnd: 300, attackRatio: 0.18 });
    this.voiced({ dur: 0.9, f0: 130, peak: 0.025 });
  }

  /**
   * Démarre la « prise d'air » de la phase de pari : quelques grandes
   * respirations, puis une dernière très grande inspiration calée pour
   * culminer juste avant la plongée (≈ `remainingMs` à partir de maintenant).
   */
  startBreathing(remainingMs: number): void {
    if (!this.ctx) return;
    this.stopBreathing();
    const big = Math.max(300, remainingMs - 1800); // début de la grande inspiration finale
    // Respirations amples avant la grande inspiration.
    let t = 150;
    let isInhale = true;
    while (t < big - 900) {
      const inhale = isInhale;
      this.breathTimers.push(setTimeout(() => (inhale ? this.inhale(false) : this.exhale()), t));
      t += inhale ? 1250 : 1050;
      isInhale = !isInhale;
    }
    // La grande inspiration finale.
    this.breathTimers.push(setTimeout(() => this.inhale(true), big));
  }

  stopBreathing(): void {
    this.breathTimers.forEach((id) => clearTimeout(id));
    this.breathTimers = [];
  }

  // ─────────────────────────────────────────────────────────── apnée

  /** Démarre le souffle retenu (apnée) : nappe de tension + contractions. */
  startBreathHold(): void {
    if (!this.ctx || !this.master) return;
    this.stopBreathHold();
    const ctx = this.ctx;
    this.holdActive = true;
    this.holdMultiplier = 1;

    // Nappe de « pression » : bruit très grave + sous-grave sinusoïdal.
    const src = ctx.createBufferSource();
    src.buffer = this.whiteBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 130;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = 62;
    const subG = ctx.createGain();
    subG.gain.value = 0.04;
    src.connect(lp).connect(g).connect(this.master);
    sub.connect(subG).connect(this.master);
    src.start();
    sub.start();
    this.holdNodes = [src, lp, g, sub, subG];
    this.holdDroneFilter = lp;
    this.holdDroneOsc = sub;

    // Lit d'un vrai enregistrement de souffle retenu si disponible.
    this.holdBedSrc = this.playSample("breath-hold", 0.9, true);
    if (this.holdBedSrc) {
      // Le vrai souffle enregistré contient déjà le diaphragme et la glotte :
      // on efface la synthèse des contractions et on réduit la nappe.
      g.gain.setTargetAtTime(0.012, ctx.currentTime, 0.1);
      subG.gain.setTargetAtTime(0.02, ctx.currentTime, 0.1);
    } else {
      this.scheduleContraction();
    }
  }

  /** Tension croissante avec la profondeur (multiplicateur). */
  updateBreathHold(multiplier: number): void {
    this.holdMultiplier = multiplier;
    if (!this.ctx) return;
    const strain = this.strain();
    // Avec le vrai souffle : on accélère légèrement (urgence) plutôt que de
    // superposer une synthèse qui jurerait avec l'enregistrement.
    if (this.holdBedSrc) {
      this.holdBedSrc.playbackRate.setTargetAtTime(1 + strain * 0.16, this.ctx.currentTime, 0.5);
    }
    if (this.holdDroneFilter && this.holdDroneOsc) {
      this.holdDroneFilter.frequency.setTargetAtTime(130 + strain * 90, this.ctx.currentTime, 0.4);
      this.holdDroneOsc.frequency.setTargetAtTime(62 + strain * 22, this.ctx.currentTime, 0.4);
    }
  }

  stopBreathHold(): void {
    this.holdActive = false;
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    const ctx = this.ctx;
    if (this.holdBedSrc && ctx) {
      try {
        this.holdBedSrc.stop(ctx.currentTime + 0.2);
      } catch {
        /* déjà arrêté */
      }
      this.holdBedSrc = null;
    }
    this.holdNodes.forEach((n) => {
      if ((n instanceof AudioBufferSourceNode || n instanceof OscillatorNode) && ctx) {
        try {
          n.stop(ctx.currentTime + 0.2);
        } catch {
          /* déjà arrêté */
        }
      }
    });
    this.holdNodes = [];
    this.holdDroneFilter = null;
    this.holdDroneOsc = null;
  }

  /** Niveau de tension 0→1 dérivé du multiplicateur (≈1 vers 16x+). */
  private strain(): number {
    return Math.max(0, Math.min(1, Math.log2(Math.max(1, this.holdMultiplier)) / 4));
  }

  /** Boucle de contractions : intervalle qui se resserre avec la tension. */
  private scheduleContraction(): void {
    if (!this.holdActive) return;
    const strain = this.strain();
    this.diaphragmContraction(strain);
    if (Math.random() < 0.4 + strain * 0.5) {
      setTimeout(() => this.glottisCreak(strain), 90 + Math.random() * 120);
    }
    const base = 4200 - strain * 3000; // calme (4,2 s) → tendu (1,2 s)
    const interval = base * (0.85 + Math.random() * 0.3);
    this.holdTimer = setTimeout(() => this.scheduleContraction(), interval);
  }

  /** Contraction du diaphragme : thump grave + spasme de bruit filtré. */
  private diaphragmContraction(strain: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    // Thump grave.
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const f = 48 + strain * 16;
    osc.frequency.setValueAtTime(f * 1.6, t0);
    osc.frequency.exponentialRampToValueAtTime(f, t0 + 0.18);
    const og = ctx.createGain();
    const peak = 0.13 + strain * 0.12;
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
    osc.connect(og).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.34);
    // Spasme : courte bouffée de bruit très filtré (muscle qui se contracte).
    if (this.whiteBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.whiteBuf;
      src.loop = true;
      src.playbackRate.value = 0.6;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 220;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05 + strain * 0.05, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      src.connect(lp).connect(g).connect(this.master);
      src.start(t0);
      src.stop(t0 + 0.26);
    }
  }

  /** Glotte serrée : court craquement « tendu » (tension de l'apnée). */
  private glottisCreak(strain: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const dur = 0.16 + strain * 0.06;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 120 + strain * 80;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1400 + strain * 600;
    bp.Q.value = 4;
    // Tremolo rapide → grain « craquant » de la glotte qui se ferme.
    const trem = ctx.createOscillator();
    trem.type = "square";
    trem.frequency.value = 22 + strain * 18;
    const tremG = ctx.createGain();
    tremG.gain.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05 + strain * 0.07, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    trem.connect(tremG).connect(g.gain);
    osc.connect(bp).connect(g).connect(this.master);
    osc.start(t0);
    trem.start(t0);
    osc.stop(t0 + dur + 0.02);
    trem.stop(t0 + dur + 0.02);
  }

  // ─────────────────────────────────────────────── blips d'interaction

  /** Blip ponctuel paramétrable. */
  private blip(
    freqFrom: number,
    freqTo: number,
    duration: number,
    type: OscillatorType = "sine",
    volume = 0.25,
  ): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t0 + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  betPlaced(): void {
    this.blip(660, 880, 0.12, "triangle", 0.18);
  }

  betCancelled(): void {
    this.blip(440, 280, 0.12, "triangle", 0.14);
  }

  /** Remontée réussie : souffle de soulagement + petit arpège clair. */
  cashout(): void {
    if (!this.ctx) return;
    // Souffle de soulagement (on respire enfin) : échantillon réel ou synthèse.
    if (!this.playSample("relief", 0.8)) {
      this.breath({ dur: 0.9, peak: 0.2, fStart: 700, fEnd: 1600, attackRatio: 0.25 });
      this.voiced({ dur: 0.8, f0: 180, peak: 0.04 });
    }
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      this.breathTimers.push(setTimeout(() => this.blip(f, f * 1.01, 0.18, "sine", 0.2), i * 70));
    });
  }

  /** Fanfare festive : multiplicateur « de dingue » (≥ 10x). */
  bigWin(): void {
    if (!this.ctx) return;
    const notes = [523, 659, 784, 1047, 1319, 1568, 2093];
    notes.forEach((f, i) => {
      setTimeout(() => this.blip(f, f * 1.01, 0.22, "triangle", 0.22), i * 65);
    });
    setTimeout(() => this.blip(2093, 2100, 0.7, "sine", 0.15), notes.length * 65);
  }

  /** Syncope : souffle qui s'échappe (gasp) + chute grave. */
  crash(): void {
    // Expiration brutale et incontrôlée : échantillon réel ou synthèse.
    if (!this.playSample("gasp", 0.9)) {
      this.breath({ dur: 0.7, peak: 0.32, fStart: 1100, fEnd: 220, attackRatio: 0.1, q: 0.5 });
      this.voiced({ dur: 0.5, f0: 160, peak: 0.06 });
    }
    this.blip(320, 60, 0.6, "sawtooth", 0.16);
    this.blip(150, 40, 0.8, "sine", 0.2);
  }

  countdownTick(): void {
    this.blip(880, 880, 0.05, "square", 0.05);
  }

  dispose(): void {
    this.stopBreathing();
    this.stopBreathHold();
    this.ambientNodes.forEach((n) => {
      if (n instanceof AudioBufferSourceNode || n instanceof OscillatorNode) {
        try {
          n.stop();
        } catch {
          /* déjà arrêté */
        }
      }
    });
    void this.ctx?.close();
    this.ctx = null;
  }
}
