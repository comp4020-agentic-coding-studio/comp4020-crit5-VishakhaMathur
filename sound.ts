// Small Web Audio synth for game feedback — every voice is an oscillator +
// gain envelope built in code, so there are no audio files/assets and
// nothing to license. Deliberately untested "how", same as renderer.ts's
// canvas drawing: it makes sound, it doesn't decide when to.
let ctx: AudioContext | null = null;

// Browsers block audio until a user gesture; every export here is only ever
// called from inside the canvas's pointerdown handler or the frame loop
// that follows it, so the context is always created/resumed on a gesture.
function getContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

interface ToneOptions {
  type: OscillatorType;
  freqStart: number;
  freqEnd?: number;
  duration: number;
  peakGain?: number;
}

function playTone(opts: ToneOptions, when = 0): void {
  const audio = getContext();
  const startTime = audio.currentTime + when;
  const osc = audio.createOscillator();
  const gain = audio.createGain();

  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.freqStart, startTime);
  if (opts.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, startTime + opts.duration);
  }

  const peakGain = opts.peakGain ?? 0.2;
  gain.gain.setValueAtTime(peakGain, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + opts.duration);

  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(startTime);
  osc.stop(startTime + opts.duration + 0.02);
}

function playArpeggio(freqs: number[], noteDuration: number, gap: number): void {
  freqs.forEach((freq, i) => {
    playTone({ type: "triangle", freqStart: freq, duration: noteDuration, peakGain: 0.16 }, i * gap);
  });
}

/** A short burst of white noise through a decaying lowpass filter — the
 *  "boom" component beneath playMeteorExplosion's low-frequency thump. */
function playNoiseBurst(duration: number, peakGain: number): void {
  const audio = getContext();
  const startTime = audio.currentTime;
  const sampleCount = Math.ceil(audio.sampleRate * duration);
  const buffer = audio.createBuffer(1, sampleCount, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = audio.createBufferSource();
  source.buffer = buffer;

  const filter = audio.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(3200, startTime);
  filter.frequency.exponentialRampToValueAtTime(120, startTime + duration);

  const gain = audio.createGain();
  gain.gain.setValueAtTime(peakGain, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  source.start(startTime);
  source.stop(startTime + duration + 0.02);
}

/** The correct move: a meteor destroyed before it reaches the star — a
 *  noise-burst boom layered under a low sine thump for real explosive punch,
 *  rather than a simple tonal blip. */
export function playMeteorExplosion(): void {
  playNoiseBurst(0.35, 0.3);
  playTone({ type: "sine", freqStart: 150, freqEnd: 35, duration: 0.3, peakGain: 0.28 });
}

/** The wrong move: a balloon popped instead of let through. */
export function playBalloonMiss(): void {
  playTone({ type: "sine", freqStart: 180, freqEnd: 90, duration: 0.18, peakGain: 0.15 });
}

/** A spike reached the Glass Star unresolved. */
export function playHitTaken(): void {
  playTone({ type: "sawtooth", freqStart: 140, freqEnd: 60, duration: 0.22, peakGain: 0.22 });
}

/** Round lost: three hits taken. */
export function playGameOver(): void {
  playArpeggio([440, 349.23, 293.66, 220], 0.22, 0.14);
}

/** Round won: survived the full timer. */
export function playWin(): void {
  playArpeggio([392, 493.88, 587.33, 783.99], 0.18, 0.11);
}
