import { UserSettings } from "./UserSettings";

/**
 * GalloFront: haptic feedback for the phone build. `navigator.vibrate` is
 * a no-op where the platform lacks it (desktop, iOS WebView), and the
 * "Vibrations" setting turns it off entirely.
 */
export type HapticCue =
  | "attack"
  | "inbound"
  | "capital_lost"
  | "research"
  | "spy_captured"
  | "raid";

// Patterns in ms (vibrate, pause, vibrate...).
const PATTERNS: Readonly<Record<HapticCue, readonly number[]>> = {
  attack: [60, 40, 60],
  inbound: [80, 60, 80],
  capital_lost: [400],
  research: [30],
  spy_captured: [50, 50, 50, 50, 50],
  raid: [120, 50, 120],
};

let userSettings: UserSettings | null = null;

/** Vibrates with `pattern`; safe to call anywhere (never throws). */
export function vibrate(pattern: number | readonly number[]): boolean {
  try {
    if (typeof navigator === "undefined") return false;
    const nav = navigator as Navigator & {
      vibrate?: (pattern: number | number[]) => boolean;
    };
    if (typeof nav.vibrate !== "function") return false;
    userSettings ??= new UserSettings();
    if (!userSettings.haptics()) return false;
    return nav.vibrate(typeof pattern === "number" ? pattern : [...pattern]);
  } catch {
    return false;
  }
}

/** Plays a named cue (see PATTERNS). */
export function haptic(cue: HapticCue): boolean {
  return vibrate(PATTERNS[cue]);
}
