export type MusicMode = 'exploration' | 'boss';
export type SoundEffect = 'attack' | 'dash' | 'enemyHit' | 'enemyDeath' | 'playerHit' | 'roomClear' | 'select' | 'bossPhase';

const EXPLORATION_BASS = [73.42, 73.42, 87.31, 65.41];
const EXPLORATION_MELODY = [293.66, 349.23, 329.63, 261.63, 293.66, 392, 349.23, 246.94];
const BOSS_BASS = [73.42, 77.78, 73.42, 98, 87.31, 77.78, 65.41, 69.3];
const BOSS_MELODY = [293.66, 311.13, 392, 369.99, 293.66, 466.16, 415.3, 311.13];

export class AdaptiveMusic {
  private context?: AudioContext;
  private master?: GainNode;
  private effects?: GainNode;
  private timer?: number;
  private nextStepAt = 0;
  private step = 0;
  private mode: MusicMode = 'exploration';
  private recentEffect?: SoundEffect;

  get currentMode(): MusicMode | 'stopped' {
    return this.context ? this.mode : 'stopped';
  }

  get lastEffect(): SoundEffect | null {
    return this.recentEffect ?? null;
  }

  start(mode: MusicMode): void {
    this.mode = mode;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.setValueAtTime(0.0001, this.context.currentTime);
      this.master.gain.exponentialRampToValueAtTime(0.11, this.context.currentTime + 0.8);
      this.master.connect(this.context.destination);
      this.effects = this.context.createGain();
      this.effects.gain.setValueAtTime(0.28, this.context.currentTime);
      this.effects.connect(this.context.destination);
    }
    void this.context.resume();
    this.resetSequence();
    if (this.timer === undefined) this.timer = window.setInterval(() => this.scheduleAhead(), 80);
  }

  setMode(mode: MusicMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (!this.context || !this.master) return;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(mode === 'boss' ? 0.14 : 0.11, this.context.currentTime, 0.18);
    this.resetSequence();
  }

  playEffect(effect: SoundEffect): void {
    this.recentEffect = effect;
    if (!this.context || !this.effects || this.context.state !== 'running') return;
    const at = this.context.currentTime + 0.008;
    if (effect === 'attack') {
      this.scheduleEffectTone(520, 170, at, 0.1, 0.17, 'sawtooth');
    } else if (effect === 'dash') {
      this.scheduleEffectTone(150, 720, at, 0.2, 0.2, 'triangle');
    } else if (effect === 'enemyHit') {
      this.scheduleEffectTone(210, 115, at, 0.09, 0.16, 'square');
    } else if (effect === 'enemyDeath') {
      this.scheduleEffectTone(260, 52, at, 0.3, 0.24, 'sawtooth');
      this.scheduleNoise(at, 0.16, 0.13);
    } else if (effect === 'playerHit') {
      this.scheduleEffectTone(135, 48, at, 0.24, 0.3, 'square');
      this.scheduleNoise(at, 0.1, 0.1);
    } else if (effect === 'roomClear') {
      [261.63, 329.63, 392].forEach((frequency, index) => (
        this.scheduleEffectTone(frequency, frequency * 1.03, at + index * 0.11, 0.24, 0.13, 'sine')
      ));
    } else if (effect === 'select') {
      this.scheduleEffectTone(440, 659.25, at, 0.16, 0.12, 'sine');
    } else {
      this.scheduleEffectTone(92, 46, at, 0.65, 0.3, 'sawtooth');
      this.scheduleEffectTone(184, 69, at + 0.05, 0.55, 0.18, 'square');
    }
  }

  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    if (this.context && this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.04);
      const context = this.context;
      window.setTimeout(() => void context.close(), 180);
    }
    this.context = undefined;
    this.master = undefined;
    this.effects = undefined;
    this.recentEffect = undefined;
  }

  private resetSequence(): void {
    if (!this.context) return;
    this.step = 0;
    this.nextStepAt = this.context.currentTime + 0.08;
  }

  private scheduleAhead(): void {
    if (!this.context || !this.master || this.context.state !== 'running') return;
    const stepDuration = 60 / (this.mode === 'boss' ? 118 : 72) / 2;
    while (this.nextStepAt < this.context.currentTime + 0.35) {
      if (this.mode === 'boss') this.scheduleBossStep(this.nextStepAt, this.step);
      else this.scheduleExplorationStep(this.nextStepAt, this.step);
      this.step += 1;
      this.nextStepAt += stepDuration;
    }
  }

  private scheduleExplorationStep(at: number, step: number): void {
    if (step % 4 === 0) this.scheduleTone(EXPLORATION_BASS[(step / 4) % EXPLORATION_BASS.length], at, 1.8, 0.075, 'triangle');
    if (step % 2 === 0) {
      const note = EXPLORATION_MELODY[(step / 2) % EXPLORATION_MELODY.length];
      this.scheduleTone(note, at + 0.04, 0.55, 0.025, 'sine');
      this.scheduleTone(note * 2, at + 0.06, 0.3, 0.009, 'sine');
    }
  }

  private scheduleBossStep(at: number, step: number): void {
    const bass = BOSS_BASS[step % BOSS_BASS.length];
    this.scheduleTone(bass, at, 0.22, step % 4 === 0 ? 0.1 : 0.065, 'sawtooth');
    this.scheduleTone(bass / 2, at, 0.18, 0.045, 'square');
    if (step % 2 === 0) {
      const note = BOSS_MELODY[(step / 2) % BOSS_MELODY.length];
      this.scheduleTone(note, at + 0.025, 0.28, 0.028, 'triangle');
    }
  }

  private scheduleTone(frequency: number, at: number, duration: number, volume: number, type: OscillatorType): void {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.03);
  }

  private scheduleEffectTone(
    startFrequency: number,
    endFrequency: number,
    at: number,
    duration: number,
    volume: number,
    type: OscillatorType,
  ): void {
    if (!this.context || !this.effects) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain);
    gain.connect(this.effects);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.025);
  }

  private scheduleNoise(at: number, duration: number, volume: number): void {
    if (!this.context || !this.effects) return;
    const frameCount = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, frameCount, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) samples[index] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, at);
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.effects);
    source.start(at);
    source.stop(at + duration);
  }
}
