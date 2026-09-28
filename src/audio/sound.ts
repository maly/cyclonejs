import { MAX_SPEED } from "../sim/config.ts";
import type { GameEvent, GameView } from "../sim/game.ts";

const MUSIC_URL = new URL("../../Rotor Rave.mp3", import.meta.url).href;
const VOLUME_KEY = "cyclone-remake.volume.v1";
/** Stejná hlasitost, jakou měl mix před posuvníkem. */
export const DEFAULT_VOLUME = 0.35;
/** Skladba do hlavního výstupu. Posuvník pak mění hudbu i efekty najednou. */
const MUSIC_TRIM = 0.5;

export interface Soundscape {
  unlock(): void;
  toggle(): void;
  volume(): number;
  muted(): boolean;
  setVolume(level: number): void;
  update(view: GameView, events: readonly GameEvent[]): void;
}

export function readVolume(raw: string | null): number {
  if (raw === null) return DEFAULT_VOLUME;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
}

/** Syntéza ve Web Audio. První klávesa kontext odemkne. */
export function createSoundscape(storage: Pick<Storage, "getItem" | "setItem"> | null = browserStorage()): Soundscape {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = false;
  let level = readStoredVolume(storage);
  const music = new Audio(MUSIC_URL);
  music.loop = true;
  music.preload = "auto";
  let musicGain: GainNode | null = null;
  let wantMusic = false;
  let musicWasOn = false;
  let rotorGain: GainNode | null = null;
  let chop: AudioBufferSourceNode | null = null;
  let body: OscillatorNode | null = null;
  let bodyTwin: OscillatorNode | null = null;
  let wind: AudioBufferSourceNode | null = null;
  let windGain: GainNode | null = null;
  let winch: OscillatorNode | null = null;
  let winchGain: GainNode | null = null;
  let refuel: OscillatorNode | null = null;
  let refuelGain: GainNode | null = null;
  let warningClock = 0;
  let alarmClock = 0;

  const ensure = () => {
    if (context) return;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = muted ? 0 : level;
    master.connect(context.destination);
    const musicSource = context.createMediaElementSource(music);
    musicGain = context.createGain();
    musicGain.gain.value = 0;
    musicSource.connect(musicGain);
    musicGain.connect(master);
    const rotor = rotorVoice(context);
    rotorGain = rotor.output;
    chop = rotor.chop;
    body = rotor.body;
    bodyTwin = rotor.bodyTwin;
    rotor.output.connect(master);
    const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    wind = context.createBufferSource();
    wind.buffer = noise;
    wind.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400;
    windGain = context.createGain();
    windGain.gain.value = 0;
    wind.connect(filter);
    filter.connect(windGain);
    windGain.connect(master);
    wind.start();
    winch = context.createOscillator();
    winch.type = "square";
    winch.frequency.value = 160;
    winchGain = context.createGain();
    winchGain.gain.value = 0;
    winch.connect(winchGain);
    winchGain.connect(master);
    winch.start();
    refuel = context.createOscillator();
    refuel.type = "sine";
    refuel.frequency.value = 240;
    refuelGain = context.createGain();
    refuelGain.gain.value = 0;
    refuel.connect(refuelGain);
    refuelGain.connect(master);
    refuel.start();
  };

  const blip = (frequency: number, duration: number, type: OscillatorType, gain = 0.12) => {
    if (!context || !master || muted) return;
    const tone = context.createOscillator();
    const amp = context.createGain();
    tone.type = type;
    tone.frequency.value = frequency;
    amp.gain.setValueAtTime(gain, context.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    tone.connect(amp);
    amp.connect(master);
    tone.start();
    tone.stop(context.currentTime + duration);
  };

  const applyLevel = () => {
    if (!master || !context) return;
    master.gain.setTargetAtTime(muted ? 0 : level, context.currentTime, 0.03);
  };

  const remember = () => {
    try {
      storage?.setItem(VOLUME_KEY, String(level));
    } catch {
      // Úložiště může chybět. Hlasitost pak platí jen do zavření stránky.
    }
  };

  const armMusic = () => {
    const started = music.play();
    void started?.catch(() => undefined);
  };

  const syncMusic = () => {
    if (!context || !musicGain) return;
    const started = wantMusic && !musicWasOn;
    if (started) music.currentTime = 0;
    musicWasOn = wantMusic;
    musicGain.gain.setTargetAtTime(wantMusic ? MUSIC_TRIM : 0, context.currentTime, 0.08);
    if (started && music.paused) void music.play().catch(() => undefined);
  };

  return {
    unlock() {
      ensure();
      if (context && context.state === "suspended") void context.resume();
      if (music.paused) armMusic();
    },
    toggle() {
      ensure();
      muted = !muted;
      applyLevel();
    },
    volume: () => level,
    muted: () => muted,
    setVolume(next) {
      ensure();
      level = Math.min(1, Math.max(0, next));
      muted = false;
      remember();
      applyLevel();
    },
    update(view, events) {
      wantMusic = view.phase === "play";
      syncMusic();
      if (!context || !rotorGain || !chop || !body || !bodyTwin || !windGain || !winchGain || !refuelGain) return;
      const flying = view.phase === "play" && view.heli.mode !== "crash";
      const thrust = Math.min(1, view.heli.speed / MAX_SPEED);
      const air = view.heli.mode === "air" ? 1 : 0;
      const now = context.currentTime;
      chop.playbackRate.setTargetAtTime(6.2 + air * 0.9 + thrust * 2.1, now, 0.08);
      body.frequency.setTargetAtTime(38 + air * 7 + thrust * 16, now, 0.08);
      bodyTwin.frequency.setTargetAtTime(40.5 + air * 7 + thrust * 17, now, 0.08);
      rotorGain.gain.setTargetAtTime(flying ? 0.16 + thrust * 0.07 : 0, now, 0.05);
      winchGain.gain.setTargetAtTime(view.winch ? 0.04 : 0, context.currentTime, 0.03);
      refuelGain.gain.setTargetAtTime(view.refueling ? 0.05 : 0, context.currentTime, 0.05);
      const planeDistance = view.plane
        ? Math.hypot(view.plane.x - view.heli.x, view.plane.y - view.heli.y, view.plane.z - view.heli.z)
        : 99;
      const flyby = view.plane && !view.plane.warning && planeDistance < 24 ? (1 - planeDistance / 24) * 0.16 : 0;
      windGain.gain.setTargetAtTime(Math.max(view.wind * 0.18, flyby), context.currentTime, 0.08);
      if (view.fuelWarning && view.phase === "play") {
        warningClock += 1 / 60;
        if (warningClock > 0.7) {
          warningClock = 0;
          blip(520, 0.12, "square", 0.06);
        }
      } else {
        warningClock = 0;
      }
      if (view.plane?.warning && view.phase === "play") {
        alarmClock += 1 / 60;
        if (alarmClock > 0.28) {
          alarmClock = 0;
          blip(alarmClock === 0 ? 880 : 660, 0.1, "square", 0.07);
        }
      } else {
        alarmClock = 0;
      }
      for (const event of events) {
        if (event.type === "pickup" && event.kind === "crate") {
          blip(330, 0.12, "square");
          blip(494, 0.18, "square");
        } else if (event.type === "pickup") {
          blip(660, 0.1, "sine");
          blip(880, 0.16, "sine");
        } else if (event.type === "crash") {
          blip(90, 0.4, "sawtooth", 0.2);
        } else if (event.type === "plane-warning") {
          blip(880, 0.16, "square", 0.1);
        } else if (event.type === "win") {
          blip(523, 0.12, "triangle");
          blip(659, 0.12, "triangle");
          blip(784, 0.28, "triangle");
        } else if (event.type === "lose") {
          blip(392, 0.16, "triangle");
          blip(311, 0.16, "triangle");
          blip(247, 0.32, "triangle");
        }
      }
    },
  };
}

function readStoredVolume(storage: Pick<Storage, "getItem"> | null): number {
  try {
    return readVolume(storage?.getItem(VOLUME_KEY) ?? null);
  } catch {
    return DEFAULT_VOLUME;
  }
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Dunění plus dva údery listů na otáčku. Obálka moduluje hlasitost, sama není tón. */
function rotorVoice(context: AudioContext): {
  output: GainNode;
  chop: AudioBufferSourceNode;
  body: OscillatorNode;
  bodyTwin: OscillatorNode;
} {
  const output = context.createGain();
  output.gain.value = 0;
  const chopGain = context.createGain();
  chopGain.gain.value = 0.28;
  chopGain.connect(output);

  const bodyFilter = context.createBiquadFilter();
  bodyFilter.type = "lowpass";
  bodyFilter.frequency.value = 150;
  bodyFilter.Q.value = 0.6;
  bodyFilter.connect(chopGain);
  const body = context.createOscillator();
  body.type = "triangle";
  body.frequency.value = 42;
  const bodyTwin = context.createOscillator();
  bodyTwin.type = "triangle";
  bodyTwin.frequency.value = 45;
  const bodyMix = context.createGain();
  bodyMix.gain.value = 0.55;
  body.connect(bodyMix);
  bodyTwin.connect(bodyMix);
  bodyMix.connect(bodyFilter);
  body.start();
  bodyTwin.start();

  const air = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const airData = air.getChannelData(0);
  for (let i = 0; i < airData.length; i++) airData[i] = Math.random() * 2 - 1;
  const rush = context.createBufferSource();
  rush.buffer = air;
  rush.loop = true;
  const band = context.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 280;
  band.Q.value = 0.8;
  const rushGain = context.createGain();
  rushGain.gain.value = 0.45;
  rush.connect(band);
  band.connect(rushGain);
  rushGain.connect(chopGain);
  rush.start();

  const cycle = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const slap = cycle.getChannelData(0);
  const pulse = (t: number, at: number, width: number, amp: number) => {
    const distance = (t - at + 1) % 1;
    if (distance > width) return 0;
    return amp * Math.exp((-distance / width) * 4.2);
  };
  for (let i = 0; i < slap.length; i++) {
    const t = i / slap.length;
    slap[i] = pulse(t, 0, 0.16, 1) + pulse(t, 0.5, 0.12, 0.62);
  }
  const chop = context.createBufferSource();
  chop.buffer = cycle;
  chop.loop = true;
  chop.playbackRate.value = 7;
  chop.connect(chopGain.gain);
  chop.start();
  return { output, chop, body, bodyTwin };
}
