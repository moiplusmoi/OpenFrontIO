import { Tick } from "@openfront/engine-api/game/GameTypes";

/**
 * GalloFront seasons: a 12-minute cycle (spring → summer → autumn → winter,
 * 3 minutes each) that is a pure function of the tick, so every client and
 * the server agree without any extra state. Effects live in Config.
 */
export enum Season {
  Spring = "spring",
  Summer = "summer",
  Autumn = "autumn",
  Winter = "winter",
}

export const SEASON_TICKS: Tick = 1800;
export const SEASON_ORDER: readonly Season[] = [
  Season.Spring,
  Season.Summer,
  Season.Autumn,
  Season.Winter,
];
export const SEASON_CYCLE_TICKS: Tick = SEASON_TICKS * SEASON_ORDER.length;

export function seasonAt(tick: Tick): Season {
  const t = Math.max(0, tick);
  return SEASON_ORDER[Math.floor((t % SEASON_CYCLE_TICKS) / SEASON_TICKS)];
}

/** Fraction (0–1) of the current season elapsed, for the HUD. */
export function seasonProgress(tick: Tick): number {
  const t = Math.max(0, tick);
  return (t % SEASON_TICKS) / SEASON_TICKS;
}

/** Ticks until the next season starts. */
export function ticksToNextSeason(tick: Tick): Tick {
  const t = Math.max(0, tick);
  return SEASON_TICKS - (t % SEASON_TICKS);
}
