import {
  PlayerInfo,
  PlayerType,
  TECH_TREE,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { setup } from "../util/Setup";

// GalloFront eras: one per three technologies owned, up to era 3. Late units
// wait for their era on top of their technology.

function playerWith(count: number) {
  const owned = new Set<TechId>(TECH_TREE.slice(0, count).map((t) => t.id));
  return { hasTech: (id: TechId) => owned.has(id) };
}

describe("eras", () => {
  test("one era per three technologies, up to era 3", async () => {
    const game = await setup("big_plains", { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    ]);
    const cfg = game.config();
    expect(cfg.eraOf(playerWith(0))).toBe(1);
    expect(cfg.eraOf(playerWith(2))).toBe(1);
    expect(cfg.eraOf(playerWith(3))).toBe(2);
    expect(cfg.eraOf(playerWith(5))).toBe(2);
    expect(cfg.eraOf(playerWith(6))).toBe(3);
    expect(cfg.eraOf(playerWith(TECH_TREE.length))).toBe(3);
  });

  test("the late units need their era", async () => {
    const game = await setup("big_plains", { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    ]);
    const cfg = game.config();
    expect(cfg.unitRequiredEra(UnitType.Warship)).toBe(1);
    expect(cfg.unitRequiredEra(UnitType.Bomber)).toBe(2);
    expect(cfg.unitRequiredEra(UnitType.Submarine)).toBe(2);
    expect(cfg.unitRequiredEra(UnitType.Carrier)).toBe(3);
    expect(cfg.unitRequiredEra(UnitType.Fighter)).toBe(3);
  });
});
