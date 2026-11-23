/**
 * Tiny Web Audio sound effects for Battle Arena — no audio files to
 * download, no external assets. Everything is synthesized with oscillators
 * on first use (created lazily, so no AudioContext exists before a user
 * gesture). Sound is decoration: every call is guarded so a failure can
 * never break the game.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

function tone(
  ctx: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  type: OscillatorType,
  volume: number
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + startAt);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + startAt);
  gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    ctx.currentTime + startAt + duration
  );
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + startAt);
  osc.stop(ctx.currentTime + startAt + duration + 0.05);
}

export type ArenaSound =
  | "correct"
  | "wrong"
  | "tick"
  | "win"
  | "match"
  | "click";

export function playArenaSound(name: ArenaSound, muted: boolean) {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    switch (name) {
      case "correct":
        // Bright ascending chime.
        tone(ctx, 523.25, 0, 0.18, "sine", 0.18);
        tone(ctx, 783.99, 0.09, 0.25, "sine", 0.18);
        break;
      case "wrong":
        // Low buzz.
        tone(ctx, 180, 0, 0.3, "sawtooth", 0.07);
        tone(ctx, 120, 0.08, 0.3, "sawtooth", 0.07);
        break;
      case "tick":
        // Short blip for the last seconds of the timer.
        tone(ctx, 1050, 0, 0.06, "square", 0.04);
        break;
      case "win":
        // Little fanfare arpeggio.
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          tone(ctx, f, i * 0.13, 0.3, "triangle", 0.2)
        );
        break;
      case "match":
        tone(ctx, 659.25, 0, 0.15, "sine", 0.15);
        tone(ctx, 880, 0.07, 0.2, "sine", 0.15);
        break;
      case "click":
        tone(ctx, 700, 0, 0.05, "sine", 0.08);
        break;
    }
  } catch {
    // Sound is decoration — never break the game.
  }
}
