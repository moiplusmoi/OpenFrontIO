import {
  WORLD_EVENT_DURATION_TICKS,
  WORLD_EVENT_FIRST_TICK,
  WORLD_EVENT_PERIOD_TICKS,
  WorldEvent,
  worldEventAt,
} from "@openfront/engine-lib/game/WorldEvents";
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { setup } from "../util/Setup";

// Events are a pure function of the tick: calm for the first 5 minutes, then
// one 90-second event at the start of every 3-minute slot.

describe("world events", () => {
  test("calm before the first event", () => {
    expect(worldEventAt(0)).toBeNull();
    expect(worldEventAt(WORLD_EVENT_FIRST_TICK - 1)).toBeNull();
  });

  test("an event runs for its duration, then the slot is calm", () => {
    const start = WORLD_EVENT_FIRST_TICK;
    expect(worldEventAt(start)).not.toBeNull();
    expect(worldEventAt(start + WORLD_EVENT_DURATION_TICKS - 1)).not.toBeNull();
    expect(worldEventAt(start + WORLD_EVENT_DURATION_TICKS)).toBeNull();
    expect(worldEventAt(start + WORLD_EVENT_PERIOD_TICKS - 1)).toBeNull();
  });

  test("the kind is fixed per slot and every kind shows up over time", () => {
    const seen = new Set<WorldEvent>();
    for (let slot = 0; slot < 30; slot++) {
      const at = WORLD_EVENT_FIRST_TICK + slot * WORLD_EVENT_PERIOD_TICKS;
      const kind = worldEventAt(at);
      expect(kind).not.toBeNull();
      expect(worldEventAt(at + 1)).toBe(kind);
      seen.add(kind!);
    }
    expect(seen.size).toBe(3);
  });

  test("the configured effects match the event kinds", async () => {
    const game = await setup("half_land_half_ocean", { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    ]);
    const cfg = game.config();
    expect(cfg.worldEventGrowthPct(WorldEvent.Drought)).toBe(60);
    expect(cfg.worldEventGrowthPct(WorldEvent.Crisis)).toBe(100);
    expect(cfg.worldEventGoldPct(WorldEvent.Crisis)).toBe(60);
    expect(cfg.worldEventGoldPct(WorldEvent.Boom)).toBe(150);
    expect(cfg.worldEventGoldPct(null)).toBe(100);
  });
});
