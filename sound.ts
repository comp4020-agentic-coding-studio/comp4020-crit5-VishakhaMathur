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

interface NoiseBurstOptions {
  duration: number;
  peakGain: number;
  filterStart?: number;
  filterEnd?: number;
}

/** A burst of white noise through a decaying lowpass filter — the "boom"
 *  component beneath both explosion sounds below. filterStart/End control
 *  how bright vs. muffled/deep the boom reads. */
function playNoiseBurst(opts: NoiseBurstOptions, when = 0): void {
  const audio = getContext();
  const startTime = audio.currentTime + when;
  const { duration, peakGain, filterStart = 3200, filterEnd = 120 } = opts;
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
  filter.frequency.setValueAtTime(filterStart, startTime);
  filter.frequency.exponentialRampToValueAtTime(filterEnd, startTime + duration);

  const gain = audio.createGain();
  gain.gain.setValueAtTime(peakGain, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  source.start(startTime);
  source.stop(startTime + duration + 0.02);
}

/** The correct move: a meteor destroyed before it reaches the planet — a
 *  sharp noise "crack" transient, a deeper noise "body" underneath it, and a
 *  short, barely-sweeping low thump for weight. Deliberately NOT a
 *  fast-sweeping tone: a sine gliding down in pitch is the classic cartoon
 *  balloon-pop/deflate sound, which is exactly what this used to sound like
 *  — the thump here holds close to one low pitch instead of sliding. */
export function playMeteorExplosion(): void {
  playNoiseBurst({ duration: 0.05, peakGain: 0.3, filterStart: 5000, filterEnd: 1800 });
  playNoiseBurst({ duration: 0.32, peakGain: 0.32, filterStart: 1600, filterEnd: 100 });
  playTone({ type: "sine", freqStart: 90, freqEnd: 60, duration: 0.14, peakGain: 0.3 });
}

/** The wrong move, at planet scale: a meteor gets through and the shield
 *  fails on the third hit. Bigger and deeper than playMeteorExplosion —
 *  a sharp crack transient, a long muffled rumble tail, and a much lower,
 *  longer sine thump — so it reads as the planet itself taking damage,
 *  not just another meteor popping. */
export function playPlanetDestroyed(): void {
  playNoiseBurst({ duration: 0.12, peakGain: 0.35, filterStart: 6000, filterEnd: 1500 });
  playNoiseBurst({ duration: 0.9, peakGain: 0.4, filterStart: 1400, filterEnd: 50 });
  playTone({ type: "sine", freqStart: 85, freqEnd: 22, duration: 0.7, peakGain: 0.4 });
}

/** The wrong move: a balloon popped instead of let through. */
export function playBalloonMiss(): void {
  playTone({ type: "sine", freqStart: 180, freqEnd: 90, duration: 0.18, peakGain: 0.15 });
}

/** A spike reached the Glass Star unresolved. */
export function playHitTaken(): void {
  playTone({ type: "sawtooth", freqStart: 140, freqEnd: 60, duration: 0.22, peakGain: 0.22 });
}

/** Round won: survived the full timer. */
export function playWin(): void {
  playArpeggio([392, 493.88, 587.33, 783.99], 0.18, 0.11);
}

// --- Background music -------------------------------------------------
// A driving minor ostinato — a pulsing sawtooth bass on every beat under a
// faster triangle arpeggio — synthesized the same way as the SFX above
// (plain oscillators, no audio files). A slow ambient pad was tried first
// and played fine on its own, but under actual meteors-incoming, spikes
// ramping up, and a 3-minute survival clock it read as the wrong mood
// entirely — this replaces it with something that matches the tension
// instead of undercutting it. Runs through its own gain node so the mute
// toggle can silence it independently of one-shot SFX.
const MUSIC_VOLUME = 0.06;
const BEAT_SECONDS = 60 / 138; // brisk, not frantic
const BAR_SECONDS = BEAT_SECONDS * 4;
// One low root per bar, cycling — a tense minor descent under the pulse.
const BAR_ROOTS = [65.41, 58.27, 51.91, 49.0]; // C2, Bb1, Ab1, G1

/** The arpeggio riding two octaves above a bar's root: root, minor third,
 *  fifth, octave. */
function arpeggioFor(root: number): number[] {
  const up = root * 4;
  return [up, up * 1.189, up * 1.5, up * 2];
}

let musicGain: GainNode | null = null;
let musicTimer: ReturnType<typeof setTimeout> | null = null;
let musicMuted = false;
let barIndex = 0;

function ensureMusicGain(): GainNode {
  const audio = getContext();
  if (!musicGain) {
    musicGain = audio.createGain();
    musicGain.gain.value = musicMuted ? 0 : MUSIC_VOLUME;
    musicGain.connect(audio.destination);
  }
  return musicGain;
}

function playMusicNote(
  freq: number,
  type: OscillatorType,
  peakGain: number,
  duration: number,
  when: number,
): void {
  const audio = getContext();
  const gain = ensureMusicGain();
  const startTime = audio.currentTime + when;
  const osc = audio.createOscillator();
  const voiceGain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  voiceGain.gain.setValueAtTime(0, startTime);
  voiceGain.gain.linearRampToValueAtTime(peakGain, startTime + 0.01);
  voiceGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(voiceGain);
  voiceGain.connect(gain);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

function playBar(index: number): void {
  const root = BAR_ROOTS[index % BAR_ROOTS.length];
  // A sawtooth stab on every beat — the "pulse" that reads as tension/danger.
  for (let beat = 0; beat < 4; beat++) {
    playMusicNote(root, "sawtooth", 0.5, 0.16, beat * BEAT_SECONDS);
  }
  // A faster triangle arpeggio on top, twice per beat, syncopated against it.
  const arp = arpeggioFor(root);
  const step = BEAT_SECONDS / 2;
  for (let i = 0; i < 8; i++) {
    playMusicNote(arp[i % arp.length], "triangle", 0.22, step * 0.85, i * step);
  }
}

/** Starts the looping ostinato; a no-op if it's already running. Safe to
 *  call from the same gesture that unlocks the AudioContext. */
export function startMusic(): void {
  if (musicTimer !== null) return;
  ensureMusicGain();
  const scheduleNext = (): void => {
    playBar(barIndex);
    barIndex += 1;
    musicTimer = setTimeout(scheduleNext, BAR_SECONDS * 1000);
  };
  scheduleNext();
}

/** Stops the loop outright (used when a round resets) so a fresh round
 *  restarts from the first bar. */
export function stopMusic(): void {
  if (musicTimer !== null) {
    clearTimeout(musicTimer);
    musicTimer = null;
  }
  barIndex = 0;
}

/** The mute toggle: silences/restores the music gain without touching the
 *  running loop, so toggling mid-chord doesn't glitch or restart it. */
export function setMusicMuted(muted: boolean): void {
  musicMuted = muted;
  if (musicGain) {
    musicGain.gain.setTargetAtTime(muted ? 0 : MUSIC_VOLUME, getContext().currentTime, 0.05);
  }
}

export function isMusicMuted(): boolean {
  return musicMuted;
}
