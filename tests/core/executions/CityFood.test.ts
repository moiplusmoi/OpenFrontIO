import {
  PlayerInfo,
  PlayerType,
  ResourceType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

// Cities eat food from their own stock. A city with none is hungry, and only
// the fed share of the cities earns the workers' gold.

async function game(): Promise<{ game: Game; p1: Player }> {
  const g = await setup("plains", { instantBuild: true }, [
    new PlayerInfo("p1", PlayerType.Human, null, "p1"),
  ]);
  executeTicks(g, 50);
  const p1 = g.player("p1");
  // A spawned player runs its PlayerExecution, which is where gold and food live.
  g.addExecution(new SpawnExecution("game_id", p1.info(), g.ref(5, 5)));
  executeTicks(g, 3);
  for (let x = 0; x <= 60; x++) {
    for (let y = 0; y <= 60; y++) p1.conquer(g.ref(x, y));
  }
  return { game: g, p1 };
}

describe("city food", () => {
  test("a new city starts with its food reserve", async () => {
    const { game: g, p1 } = await game();
    const city = p1.buildUnit(UnitType.City, g.ref(10, 10), {});
    expect(city.stock(ResourceType.Food)).toBe(g.config().cityStartingFood());
  });

  test("a city eats its food over time", async () => {
    const { game: g, p1 } = await game();
    const city = p1.buildUnit(UnitType.City, g.ref(10, 10), {});
    const before = city.stock(ResourceType.Food);
    executeTicks(g, 300);
    expect(city.stock(ResourceType.Food)).toBeLessThan(before);
  });

  test("a hungry city lowers the workers' gold", async () => {
    const { game: g, p1 } = await game();
    const fed = p1.buildUnit(UnitType.City, g.ref(10, 10), {});
    const hungry = p1.buildUnit(UnitType.City, g.ref(40, 40), {});
    // Two fed cities earn the full workers' gold.
    const start = p1.gold();
    executeTicks(g, 200);
    const bothFed = p1.gold() - start;

    // One city starves: half the cities are fed, so about half the gold.
    hungry.takeStock(ResourceType.Food, hungry.stock(ResourceType.Food));
    expect(fed.stock(ResourceType.Food)).toBeGreaterThan(0);
    const start2 = p1.gold();
    executeTicks(g, 200);
    const oneFed = p1.gold() - start2;

    expect(bothFed).toBeGreaterThan(0n);
    expect(oneFed).toBeLessThan(bothFed);
  });
});
