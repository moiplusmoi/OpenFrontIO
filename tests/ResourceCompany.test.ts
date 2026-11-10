import {
  PlayerInfo,
  PlayerType,
  ResourceType,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// Trade companies move surplus resources without any order from the player:
// first to the player's own structures that need them, then to a trading
// neighbour, who pays on arrival.

async function world(): Promise<{ game: Game; p1: Player; p2: Player }> {
  const g = await setup("plains", { instantBuild: true }, [
    new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    new PlayerInfo("p2", PlayerType.Human, null, "p2"),
  ]);
  executeTicks(g, 50);
  const p1 = g.player("p1");
  const p2 = g.player("p2");
  g.addExecution(new SpawnExecution("game_id", p1.info(), g.ref(5, 5)));
  g.addExecution(new SpawnExecution("game_id", p2.info(), g.ref(55, 55)));
  executeTicks(g, 3);
  for (let x = 0; x <= 30; x++) {
    for (let y = 0; y <= 60; y++) p1.conquer(g.ref(x, y));
  }
  for (let x = 31; x <= 60; x++) {
    for (let y = 0; y <= 60; y++) p2.conquer(g.ref(x, y));
  }
  for (const t of [TechId.Mil1, TechId.Mil2]) {
    p1.startResearch(t, 0);
    p1.completeResearch();
    p2.startResearch(t, 0);
    p2.completeResearch();
  }
  p1.addGold(10_000_000n);
  p2.addGold(10_000_000n);
  return { game: g, p1, p2 };
}

describe("resource trade companies", () => {
  test("a surplus goes to the player's own structure that needs it, with no order", async () => {
    const { game: g, p1 } = await world();
    const surplus = p1.buildUnit(UnitType.Airport, g.ref(10, 10), {});
    const hungry = p1.buildUnit(UnitType.Airport, g.ref(40, 10), {});
    surplus.addStock(ResourceType.Food, 120);
    hungry.takeStock(ResourceType.Food, hungry.stock(ResourceType.Food));

    executeTicks(g, 400);

    expect(hungry.stock(ResourceType.Food)).toBeGreaterThan(0);
    expect(surplus.stock(ResourceType.Food)).toBeLessThan(120);
  });

  test("with no surplus, nothing moves", async () => {
    const { game: g, p1 } = await world();
    const quiet = p1.buildUnit(UnitType.Airport, g.ref(10, 10), {});
    const other = p1.buildUnit(UnitType.Airport, g.ref(40, 10), {});
    quiet.addStock(ResourceType.Food, 30);
    other.takeStock(ResourceType.Food, other.stock(ResourceType.Food));

    executeTicks(g, 400);

    expect(quiet.stock(ResourceType.Food)).toBe(30);
    expect(other.stock(ResourceType.Food)).toBe(0);
  });

  test("a surplus with no own buyer is sold to a neighbour, who pays", async () => {
    // Same world twice: with and without the sale. Gold income is the same in
    // both, so the difference is exactly what the buyer paid.
    const run = async (embargo: boolean) => {
      const { game: g, p1, p2 } = await world();
      const seller = p1.buildUnit(UnitType.Airport, g.ref(10, 10), {});
      const buyer = p2.buildUnit(UnitType.Airport, g.ref(45, 10), {});
      seller.addStock(ResourceType.Food, 120);
      buyer.takeStock(ResourceType.Food, buyer.stock(ResourceType.Food));
      if (embargo) p1.addEmbargo(p2, false);
      const p1Gold = p1.gold();
      const p2Gold = p2.gold();
      executeTicks(g, 600);
      return {
        delivered: buyer.stock(ResourceType.Food),
        p1Gain: p1.gold() - p1Gold,
        p2Gain: p2.gold() - p2Gold,
      };
    };
    const sold = await run(false);
    const none = await run(true);

    expect(sold.delivered).toBeGreaterThan(0);
    const price = (await world()).game
      .config()
      .resourcePrice(ResourceType.Food);
    expect(sold.p2Gain).toBe(none.p2Gain - price * BigInt(sold.delivered));
    expect(sold.p1Gain).toBeGreaterThan(none.p1Gain);
  }, 60_000);

  test("an embargo stops the companies from selling to that neighbour", async () => {
    const { game: g, p1, p2 } = await world();
    const seller = p1.buildUnit(UnitType.Airport, g.ref(10, 10), {});
    const buyer = p2.buildUnit(UnitType.Airport, g.ref(45, 10), {});
    seller.addStock(ResourceType.Food, 120);
    buyer.takeStock(ResourceType.Food, buyer.stock(ResourceType.Food));
    p1.addEmbargo(p2, false);

    executeTicks(g, 600);

    expect(buyer.stock(ResourceType.Food)).toBe(0);
  });
});
