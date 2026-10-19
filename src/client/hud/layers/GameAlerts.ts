/**
 * GalloFront: full-screen alerts while playing — a coloured toast under the
 * HUD (HeadsUpMessage's `show-message`) and a pulse of the screen border
 * (AlertFrame's `game-alert-frame`). Rate-limited to one alert per
 * ALERT_COOLDOWN_MS so a volley of attacks doesn't flash the screen
 * continuously; haptics are left to the callers.
 */
export type GameAlertKind = "attack" | "inbound";

export const GAME_ALERT_FRAME_EVENT = "game-alert-frame";
export const ALERT_COOLDOWN_MS = 5_000;
export const ALERT_TOAST_DURATION_MS = 4_000;

const ALERT_COLOR: Readonly<Record<GameAlertKind, "red" | "yellow">> = {
  attack: "red",
  inbound: "yellow",
};

let lastAlertAt = -Infinity;

/** @returns false when the alert was swallowed by the cooldown. */
export function raiseGameAlert(kind: GameAlertKind, message: string): boolean {
  if (typeof window === "undefined") return false;
  const now = Date.now();
  if (now - lastAlertAt < ALERT_COOLDOWN_MS) return false;
  lastAlertAt = now;
  window.dispatchEvent(
    new CustomEvent("show-message", {
      detail: {
        message,
        color: ALERT_COLOR[kind],
        duration: ALERT_TOAST_DURATION_MS,
      },
    }),
  );
  window.dispatchEvent(
    new CustomEvent<GameAlertKind>(GAME_ALERT_FRAME_EVENT, { detail: kind }),
  );
  return true;
}

/** Tests: forget the cooldown. */
export function resetGameAlerts(): void {
  lastAlertAt = -Infinity;
}
