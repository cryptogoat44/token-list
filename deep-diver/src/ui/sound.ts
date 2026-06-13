/**
 * Sons synthétisés à la volée via Web Audio API — aucun fichier audio.
 * Tout reste volontairement discret : ambiance sous-marine en nappe filtrée,
 * petits blips d'interaction, alarme sobre à la syncope.
 */

export class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientNodes: AudioNode[] = [];
  private diveOsc: OscillatorNode | null = null;
  private diveGain: GainNode | null = null;
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
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
  }

  /** À appeler depuis un geste utilisateur (politique d'autoplay). */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this._muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.startAmbient();
  }

  /** Nappe d'ambiance : bruit filtré très grave + lente respiration. */
  private startAmbient(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // bruit brun (intégration de bruit blanc) : rumble océanique
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 220;
    const gain = ctx.createGain();
    gain.gain.value = 0.18;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07; // respiration très lente
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.06;
    lfo.connect(lfoGain).connect(gain.gain);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    lfo.start();
    this.ambientNodes = [src, filter, gain, lfo];
  }

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

  /** Petit arpège ascendant : remontée réussie. */
  cashout(): void {
    if (!this.ctx) return;
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      setTimeout(() => this.blip(f, f * 1.01, 0.18, "sine", 0.2), i * 70);
    });
  }

  /** Fanfare festive : multiplicateur « de dingue » (≥ 10x). */
  bigWin(): void {
    if (!this.ctx) return;
    // Arpège majeur sur deux octaves + une note tenue brillante.
    const notes = [523, 659, 784, 1047, 1319, 1568, 2093];
    notes.forEach((f, i) => {
      setTimeout(() => this.blip(f, f * 1.01, 0.22, "triangle", 0.22), i * 65);
    });
    setTimeout(() => this.blip(2093, 2100, 0.7, "sine", 0.15), notes.length * 65);
  }

  /** Syncope : chute grave + souffle. */
  crash(): void {
    this.blip(320, 60, 0.6, "sawtooth", 0.16);
    this.blip(150, 40, 0.8, "sine", 0.2);
  }

  countdownTick(): void {
    this.blip(880, 880, 0.05, "square", 0.05);
  }

  /** Début de plongée : nappe de tension qui montera avec le multiplicateur. */
  startDive(): void {
    if (!this.ctx || !this.master) return;
    this.stopDive();
    const ctx = this.ctx;
    this.diveOsc = ctx.createOscillator();
    this.diveOsc.type = "sine";
    this.diveOsc.frequency.value = 110;
    this.diveGain = ctx.createGain();
    this.diveGain.gain.value = 0.035;
    this.diveOsc.connect(this.diveGain).connect(this.master);
    this.diveOsc.start();
  }

  /** Tension proportionnelle au multiplicateur (fréquence qui grimpe). */
  updateDive(multiplier: number): void {
    if (!this.diveOsc || !this.ctx) return;
    const freq = Math.min(440, 110 + Math.log2(multiplier) * 70);
    this.diveOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.2);
  }

  stopDive(): void {
    if (this.diveOsc && this.diveGain && this.ctx) {
      this.diveGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      const osc = this.diveOsc;
      setTimeout(() => osc.stop(), 400);
    }
    this.diveOsc = null;
    this.diveGain = null;
  }

  dispose(): void {
    this.stopDive();
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
