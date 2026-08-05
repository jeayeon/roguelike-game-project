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
  private musicVolume = 0.65;
  private effectsVolume = 0.75;
  private musicStarted = false;

  get currentMode(): MusicMode | 'stopped' {
    return this.context && this.musicStarted ? this.mode : 'stopped';
  }

  get audioState(): AudioContextState | 'uninitialized' {
    return this.context?.state ?? 'uninitialized';
  }

  get lastEffect(): SoundEffect | null {
    return this.recentEffect ?? null;
  }

  get volumes(): { music: number; effects: number } {
    return { music: this.musicVolume, effects: this.effectsVolume };
  }

  setVolumes(music: number, effects: number): void {
    this.musicVolume = Math.min(1, Math.max(0, music));
    this.effectsVolume = Math.min(1, Math.max(0, effects));
    this.applyVolumes();
  }

  start(mode: MusicMode): void {
    this.mode = mode;
    this.musicStarted = true;
    this.unlock();
  }

  unlock(): void {
    this.ensureContext();
    const context = this.context;
    if (!context) return;
    const unlocked = (): void => {
      if (this.context !== context || context.state !== 'running') return;
      if (this.musicStarted && this.timer === undefined) this.beginMusicPlayback();
    };
    if (context.state === 'running') unlocked();
    else void context.resume().then(unlocked).catch(() => undefined);
  }

  setMode(mode: MusicMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (!this.context || !this.master) return;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(this.getMusicGain(), this.context.currentTime, 0.18);
    this.resetSequence();
  }

  playEffect(effect: SoundEffect): void {
    this.recentEffect = effect;
    this.ensureContext();
    const context = this.context;
    if (!context) return;
    const play = (): void => {
      if (this.context !== context || context.state !== 'running' || !this.effects) return;
      this.scheduleEffect(effect, context.currentTime + 0.008);
    };
    if (context.state === 'running') play();
    else void context.resume().then(play).catch(() => undefined);
  }

  private scheduleEffect(effect: SoundEffect, at: number): void {
    if (effect === 'attack') {
      this.scheduleSwordWhoosh(at);
    } else if (effect === 'dash') {
      this.scheduleEffectTone(150, 720, at, 0.2, 0.2, 'triangle');
    } else if (effect === 'enemyHit') {
      this.scheduleBladeImpact(at);
    } else if (effect === 'enemyDeath') {
      this.scheduleEffectTone(260, 52, at, 0.3, 0.24, 'sawtooth');
      this.scheduleNoise(at, 0.16, 0.13);
    } else if (effect === 'playerHit') {
      this.schedulePlayerImpact(at);
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
    this.musicStarted = false;
  }

  private resetSequence(): void {
    if (!this.context) return;
    this.step = 0;
    this.nextStepAt = this.context.currentTime + 0.08;
  }

  private beginMusicPlayback(): void {
    if (!this.context || !this.master || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(0.0001, now);
    this.master.gain.exponentialRampToValueAtTime(this.getMusicGain(), now + 0.45);
    this.resetSequence();
    this.scheduleAhead();
    this.timer = window.setInterval(() => this.scheduleAhead(), 80);
  }

  private getMusicGain(): number {
    return Math.max(0.0001, (this.mode === 'boss' ? 0.3 : 0.23) * this.musicVolume);
  }

  private getEffectsGain(): number {
    return this.effectsVolume * 0.28;
  }

  private applyVolumes(): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    if (this.master) {
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.getMusicGain(), now, 0.04);
    }
    if (this.effects) {
      this.effects.gain.cancelScheduledValues(now);
      this.effects.gain.setTargetAtTime(this.getEffectsGain(), now, 0.025);
    }
  }

  private ensureContext(): void {
    if (this.context && this.context.state !== 'closed') return;
    try {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.setValueAtTime(0.0001, this.context.currentTime);
      this.master.connect(this.context.destination);
      this.effects = this.context.createGain();
      this.effects.gain.setValueAtTime(this.getEffectsGain(), this.context.currentTime);
      this.effects.connect(this.context.destination);
    } catch {
      this.context = undefined;
      this.master = undefined;
      this.effects = undefined;
    }
  }

  private scheduleAhead(): void {
    if (!this.context || !this.master || this.context.state !== 'running') return;
    if (this.nextStepAt < this.context.currentTime - 0.5) this.resetSequence();
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

  private scheduleSwordWhoosh(at: number): void {
    if (!this.context || !this.effects) return;
    const duration = 0.23;
    const frameCount = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, frameCount, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      const envelope = Math.sin(Math.PI * index / frameCount);
      samples[index] = (Math.random() * 2 - 1) * envelope;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(0.85, at);
    filter.frequency.setValueAtTime(320, at);
    filter.frequency.exponentialRampToValueAtTime(1900 + Math.random() * 350, at + 0.075);
    filter.frequency.exponentialRampToValueAtTime(430, at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.32, at + 0.045);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.effects);
    source.start(at);
    source.stop(at + duration);
  }

  private scheduleBladeImpact(at: number): void {
    if (!this.context || !this.effects) return;
    const duration = 0.14;
    const frameCount = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, frameCount, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      const progress = index / frameCount;
      const envelope = Math.pow(1 - progress, 2.4);
      samples[index] = (Math.random() * 2 - 1) * envelope;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(0.72, at);
    filter.frequency.setValueAtTime(2900, at);
    filter.frequency.exponentialRampToValueAtTime(850, at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.36, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.effects);
    source.start(at);
    source.stop(at + duration);
    this.scheduleEffectTone(125, 72, at, 0.075, 0.07, 'triangle');
  }

  private schedulePlayerImpact(at: number): void {
    if (!this.context || !this.effects) return;
    const duration = 0.2;
    const frameCount = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, frameCount, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      const progress = index / frameCount;
      samples[index] = (Math.random() * 2 - 1) * Math.pow(1 - progress, 2.1);
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(780, at);
    filter.frequency.exponentialRampToValueAtTime(260, at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.24, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.effects);
    source.start(at);
    source.stop(at + duration);
    this.scheduleEffectTone(112, 46, at, 0.18, 0.24, 'sine');
  }
}
