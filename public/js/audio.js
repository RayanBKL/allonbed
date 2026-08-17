// ═══════════════════════════════════════════════════
// ALL ON BED — SOUND FX (Subtle, Non-Intrusive)
// ═══════════════════════════════════════════════════

class SoundFX {
  constructor() {
    this.enabled = false;
    this.ctx = null;
  }

  _ctx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this.ctx;
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled && this.ctx?.state === 'suspended') this.ctx.resume();
    return this.enabled;
  }

  _beep(freq, dur, type = 'sine', vol = 0.04) {
    if (!this.enabled) return;
    try {
      const ctx = this._ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = type;
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(freq * 0.7, ctx.currentTime + dur);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.start(); o.stop(ctx.currentTime + dur);
    } catch {}
  }

  playClick()  { this._beep(880, 0.06, 'sine', 0.03); }
  playKeyStroke() { this._beep(1200, 0.04, 'sine', 0.02); }
  playSuccess() { this._beep(660, 0.08, 'sine', 0.04); setTimeout(() => this._beep(880, 0.12), 90); }
  playError()  { this._beep(200, 0.15, 'sawtooth', 0.04); }

  playMasterVictory() {
    [0, 80, 160, 260].forEach((delay, i) => {
      setTimeout(() => this._beep([523, 659, 784, 1046][i], 0.25, 'sine', 0.06), delay);
    });
  }
}

window.soundFX = new SoundFX();
