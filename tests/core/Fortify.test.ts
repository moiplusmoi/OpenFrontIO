import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { setup } from "../util/Setup";
import { executeTicks } from "../util/utils";

// GalloFront fortification: a defence block gains +2% per full minute its
// owner keeps it (capped at +40%). A block's clock restarts when any of its
// tiles changes hands.

describe("fortification", () => {
  test("the bonus grows per full minute and is capped", async () => {
    const game = await setup("big_plains", { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    ]);
    const cfg = game.config();
    expect(cfg.fortifyBonusPct(0)).toBe(0);
    expect(cfg.fortifyBonusPct(599)).toBe(0);
    expect(cfg.fortifyBonusPct(600)).toBe(2);
    expect(cfg.fortifyBonusPct(6000)).toBe(20);
    expect(cfg.fortifyBonusPct(10_000_000)).toBe(40);
  });

  test("a block's clock restarts when a tile of it changes hands", async () => {
    const game = await setup("big_plains", { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    ]);
    executeTicks(game, 20);
    const p1 = game.player("p1");
    const tile = game.ref(40, 40);
    const neighbour = game.ref(41, 40);
    p1.conquer(tile);
    executeTicks(game, 100);
    expect(game.tileHeldTicks(tile)).toBe(100);

    // Same 16x16 block: taking the neighbour restarts the block's clock.
    p1.conquer(neighbour);
    expect(game.tileHeldTicks(tile)).toBe(0);
  });
});
