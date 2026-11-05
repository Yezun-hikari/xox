export type SoundName =
  | 'place'
  | 'placeOpponent'
  | 'score'
  | 'clear'
  | 'freeze'
  | 'thaw'
  | 'win'
  | 'lose'
  | 'turn'
  | 'match'
  | 'message';

/** f: Hz, to: slide target Hz, at: start offset s, d: length s, g: peak gain, w: waveform (default sine). */
type Note = { f: number; to?: number; at?: number; d: number; g: number; w?: OscillatorType };

const KEY = 'xox-muted';

const VOLUME = 0.3;
const SOUNDS: Record<SoundName, Note[]> = {
  place: [{ f: 520, to: 340, d: 0.09, g: 0.5 }],
  placeOpponent: [{ f: 360, to: 240, d: 0.1, g: 0.35 }],
  score: [
    { f: 659, d: 0.18, g: 0.35 },
    { f: 880, at: 0.09, d: 0.3, g: 0.35 },
  ],
  clear: [{ f: 600, to: 280, d: 0.22, g: 0.25, w: 'triangle' }],
  freeze: [
    { f: 1320, d: 0.14, g: 0.12 },
    { f: 1760, at: 0.05, d: 0.2, g: 0.1 },
  ],
  thaw: [
    { f: 740, to: 520, d: 0.1, g: 0.18 },
    { f: 520, to: 370, at: 0.08, d: 0.14, g: 0.16 },
  ],
  win: [
    { f: 523, d: 0.16, g: 0.3 },
    { f: 659, at: 0.09, d: 0.16, g: 0.3 },
    { f: 784, at: 0.18, d: 0.16, g: 0.3 },
    { f: 1047, at: 0.27, d: 0.5, g: 0.32 },
  ],
  lose: [
    { f: 440, d: 0.2, g: 0.25, w: 'triangle' },
    { f: 349, at: 0.15, d: 0.2, g: 0.25, w: 'triangle' },
    { f: 294, at: 0.3, d: 0.42, g: 0.25, w: 'triangle' },
  ],
  turn: [{ f: 660, to: 700, d: 0.18, g: 0.22 }],
  match: [
    { f: 392, d: 0.14, g: 0.28, w: 'triangle' },
    { f: 523, at: 0.1, d: 0.14, g: 0.28, w: 'triangle' },
    { f: 659, at: 0.2, d: 0.3, g: 0.28, w: 'triangle' },
  ],
  message: [
    { f: 880, d: 0.07, g: 0.16 },
    { f: 1047, at: 0.07, d: 0.1, g: 0.16 },
  ],
};

let muted = false;
try {
  muted = localStorage.getItem(KEY) === '1';
} catch {
  /* storage blocked: start unmuted */
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function unlock(): void {
  // Creating a context without a user activation logs an autoplay warning; touchend after a scroll is such a case.
  if (muted || navigator.userActivation?.isActive === false) return;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = VOLUME;
      master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
    }
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
  } catch {
    /* no audio available */
  }
}

// Stays attached: iOS can interrupt a running context, and only a gesture can resume it.
for (const type of ['mousedown', 'pointerup', 'touchend', 'keydown', 'click']) {
  window.addEventListener(type, unlock, { capture: true, passive: true });
}

function schedule(c: AudioContext, dest: AudioNode, n: Note): void {
  const t = c.currentTime + (n.at ?? 0);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = n.w ?? 'sine';
  osc.frequency.setValueAtTime(n.f, t);
  if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t + n.d);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(n.g, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + n.d);
  osc.connect(gain).connect(dest);
  osc.start(t);
  osc.stop(t + n.d + 0.02);
}

export function play(name: SoundName): void {
  if (muted || !ctx || !master) return;
  try {
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    for (const n of SOUNDS[name]) schedule(ctx, master, n);
  } catch {
    /* sound must never break the game */
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? '1' : '0');
  } catch {
    /* storage blocked: keep for this session only */
  }
  unlock(); // unmuting is usually itself the gesture; sounds should work without another click
}
