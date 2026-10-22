import {
  PlayerInfo,
  PlayerType,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AirportExecution } from "@openfront/engine/execution/AirportExecution";
import { ResearchExecution } from "@openfront/engine/execution/ResearchExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

// A carrier is a warship that launches sorties like an airport. Sorties use
// its slots and reload on the same clock; airliners never fly from it.

const MAP = "big_plains";

async function seaGame(): Promise<{ game: Game; p1: Player; p2: Player }> {
  const game = await setup(MAP, { instantBuild: true }, [
    new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    new PlayerInfo("p2", PlayerType.Human, null, "p2"),
  ]);
  executeTicks(game, 50);
  const p1 = game.player("p1");
  const p2 = game.player("p2");
  // Research needs living players: give each a block of land first.
  for (let x = 5; x < 15; x++)
    for (let y = 5; y < 15; y++) p1.conquer(game.ref(x, y));
  for (let x = 60; x < 70; x++)
    for (let y = 60; y < 70; y++) p2.conquer(game.ref(x, y));
  return { game, p1, p2 };
}

// Bombers need Aviation (mil_3) and fighters Air Superiority (mil_4); buying
// a sortie also needs gold.
function equip(game: Game, p: Player) {
  for (const id of [TechId.Mil1, TechId.Mil2, TechId.Mil3, TechId.Mil4]) {
    p.addGold(game.config().techCost(id));
    game.addExecution(new ResearchExecution(p, id));
    executeTicks(game, game.config().techDuration(id) + 3);
  }
  p.addGold(10_000_000n);
}

function carrier(game: Game, owner: Player, x: number, y: number): Unit {
  const ship = owner.buildUnit(UnitType.Carrier, game.ref(x, y), {
    patrolTile: game.ref(x, y),
  });
  // Built by WarshipExecution in the game; here we attach its slot reloader.
  game.addExecution(new AirportExecution(ship));
  return ship;
}

describe("carrier: stats", () => {
  test("health, air superiority tech and its slower, lighter hull", async () => {
    const { game } = await seaGame();
    expect(game.config().unitInfo(UnitType.Carrier).maxHealth).toBe(1800);
    expect(game.config().unitRequiredTech(UnitType.Carrier)).toBe(TechId.Mil4);
    expect(game.config().navalTraits(UnitType.Carrier)).toEqual({
      stepsPerTick: 1,
      moveEveryTicks: 2,
      shellDamagePct: 60,
    });
  });
});

describe("carrier: air base", () => {
  test("a carrier in range is a sortie base for strikes", async () => {
    const { game, p1, p2 } = await seaGame();
    equip(game, p1);
    const ship = carrier(game, p1, 10, 10);
    const target = game.ref(14, 10);
    p2.conquer(target);
    expect(p1.canBuild(UnitType.Bomber, target)).toBe(ship.tile());
  });

  test("a carrier out of range cannot launch a strike", async () => {
    const { game, p1, p2 } = await seaGame();
    equip(game, p1);
    carrier(game, p1, 10, 10);
    // Far beyond any airport range from the carrier.
    const target = game.ref(190, 190);
    p2.conquer(target);
    expect(p1.canBuild(UnitType.Bomber, target)).toBe(false);
  });

  test("fighters can be posted aboard a carrier", async () => {
    const { game, p1 } = await seaGame();
    equip(game, p1);
    const ship = carrier(game, p1, 10, 10);
    expect(p1.canBuild(UnitType.Fighter, ship.tile())).toBe(ship.tile());
  });

  test("a carrier never dispatches airliners", async () => {
    const { game, p1, p2 } = await seaGame();
    carrier(game, p1, 10, 10);
    // The other side has an airport and could trade: an airport would dispatch.
    p2.conquer(game.ref(60, 60));
    p2.buildUnit(UnitType.Airport, game.ref(60, 60), {});
    executeTicks(game, 400);
    expect(game.units(UnitType.CommercialAircraft).length).toBe(0);
  });
});
