import { Tick } from "@openfront/engine-api/game/GameTypes";

/**
 * GalloFront world events: from minute 5, an event strikes every 3 minutes
 * and lasts 90 seconds. Its kind is a hash of the slot number, so every client
 * and the server agree without any extra state. Effects live in Config.
 */
export enum WorldEvent {
  Drought = "drought",
  Crisis = "crisis",
  Boom = "boom",
}

export const WORLD_EVENT_FIRST_TICK: Tick = 3000;
export const WORLD_EVENT_PERIOD_TICKS: Tick = 1800;
export const WORLD_EVENT_DURATION_TICKS: Tick = 900;
const WORLD_EVENT_ORDER: readonly WorldEvent[] = [
  WorldEvent.Drought,
  WorldEvent.Crisis,
  WorldEvent.Boom,
];

/** The event running at `tick`, or null while the world is calm. */
export function worldEventAt(tick: Tick): WorldEvent | null {
  if (tick < WORLD_EVENT_FIRST_TICK) return null;
  const since = tick - WORLD_EVENT_FIRST_TICK;
  if (since % WORLD_EVENT_PERIOD_TICKS >= WORLD_EVENT_DURATION_TICKS) {
    return null;
  }
  const slot = Math.floor(since / WORLD_EVENT_PERIOD_TICKS);
  const kind = (Math.imul(slot + 1, 0x9e3779b1) >>> 0) % 3;
  return WORLD_EVENT_ORDER[kind];
}
