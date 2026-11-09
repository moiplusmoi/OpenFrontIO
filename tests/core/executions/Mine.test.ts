import {
  PlayerInfo,
  PlayerType,
  ResourceType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { generateResourceDeposits } from "@openfront/engine-lib/game/ResourceDeposits";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { MINE_OUTPUT } from "@openfront/engine/execution/MineExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";
import { executeTicks } from "../../util/utils";

const MAP = "half_land_half_ocean";

async function landGame(): Promise<{ game: Game; p1: Player }> {
  const game = await setup(MAP, { instantBuild: true }, [
    new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    new PlayerInfo("p2", PlayerType.Human, null, "p2"),
  ]);
  executeTicks(game, 50);
  const p1 = game.player("p1");
  p1.addGold(10_000_000n);
  return { game, p1 };
}

describe("resource deposits", () => {
  test("the same game always yields the same deposits", async () => {
    const { game } = await landGame();
    const again = generateResourceDeposits(game.map(), "");
    expect([...again.entries()]).toEqual([...game.deposits().entries()]);
  });

  test("another game on the same map gets other deposits", async () => {
    const { game } = await landGame();
    const other = generateResourceDeposits(game.map(), "another-game");
    expect([...other.keys()]).not.toEqual([...game.deposits().keys()]);
  });

  test("deposits sit on land, never next to each other, at least six", async () => {
    const { game } = await landGame();
    const tiles = [...game.deposits().keys()];
    expect(tiles.length).toBeGreaterThanOrEqual(6);
    for (const tile of tiles) {
      expect(game.isLand(tile)).toBe(true);
      expect(
        game
          .map()
          .neighbors(tile)
          .some((n) => game.depositAt(n)),
      ).toBe(false);
    }
  });
});

describe("mines", () => {
  test("a mine cannot go on a deposit the player does not own", async () => {
    const { game, p1 } = await landGame();
    const [deposit] = game.deposits().keys();
    game.addExecution(new ConstructionExecution(p1, UnitType.Mine, deposit));
    executeTicks(game, 5);
    expect(p1.units(UnitType.Mine).length).toBe(0);
  });

  test("a mine on an owned deposit fills its owner's warehouse", async () => {
    const { game, p1 } = await landGame();
    const [deposit] = game.deposits().keys();
    const resource = game.depositAt(deposit)!;
    p1.conquer(deposit);

    game.addExecution(new ConstructionExecution(p1, UnitType.Mine, deposit));
    executeTicks(game, 2);
    expect(p1.units(UnitType.Mine).length).toBe(1);

    const before = p1.resource(resource);
    executeTicks(game, 120);
    const gained = p1.resource(resource) - before;
    expect(gained).toBeGreaterThanOrEqual(MINE_OUTPUT);
    expect(gained % MINE_OUTPUT).toBe(0);
  });

  test("a second mine cannot take a deposit already worked", async () => {
    const { game, p1 } = await landGame();
    const [deposit] = game.deposits().keys();
    p1.conquer(deposit);
    game.addExecution(new ConstructionExecution(p1, UnitType.Mine, deposit));
    executeTicks(game, 2);
    game.addExecution(new ConstructionExecution(p1, UnitType.Mine, deposit));
    executeTicks(game, 2);
    expect(p1.units(UnitType.Mine).length).toBe(1);
  });

  test("a mine and its warehouse survive a snapshot round trip", async () => {
    const { game, p1 } = await landGame();
    const [deposit] = game.deposits().keys();
    p1.conquer(deposit);
    game.addExecution(new ConstructionExecution(p1, UnitType.Mine, deposit));
    executeTicks(game, 60);
    await expectSnapshotRoundTrip(game, MAP, 30);
  });
});

describe("unit resource costs", () => {
  test("building a unit spends its resources", async () => {
    const { game, p1 } = await landGame();
    // Stocks live in structures, and each holds at most the capacity.
    p1.buildUnit(UnitType.City, game.ref(3, 10), {});
    p1.addResource(ResourceType.Oil, 200);
    p1.addResource(ResourceType.Metal, 200);
    p1.buildUnit(UnitType.Carrier, game.ref(8, 10), {
      patrolTile: game.ref(8, 10),
    });
    expect(p1.resource(ResourceType.Oil)).toBe(100);
    expect(p1.resource(ResourceType.Metal)).toBe(150);
  });
});
