import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AirportExecution } from "@openfront/engine/execution/AirportExecution";
import { CommercialAircraftExecution } from "@openfront/engine/execution/CommercialAircraftExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";
import { executeTicks } from "../../util/utils";

// Airliners fly airport to airport and pay both owners on arrival. Airports
// sit on the land half of the map, at the same column, so flights are short.

const MAP = "half_land_half_ocean";

async function airportGame(): Promise<{
  game: Game;
  p1: Player;
  p2: Player;
  a1: Unit;
  a2: Unit;
}> {
  const game = await setup(MAP, { instantBuild: true }, [
    new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    new PlayerInfo("p2", PlayerType.Human, null, "p2"),
  ]);
  executeTicks(game, 50);
  const p1 = game.player("p1");
  const p2 = game.player("p2");
  p1.conquer(game.ref(2, 2));
  p2.conquer(game.ref(2, 10));
  const a1 = p1.buildUnit(UnitType.Airport, game.ref(2, 2), {});
  const a2 = p2.buildUnit(UnitType.Airport, game.ref(2, 10), {});
  return { game, p1, p2, a1, a2 };
}

function flightsOf(game: Game): Unit[] {
  return game.units(UnitType.CommercialAircraft);
}

describe("commercial aircraft", () => {
  test("an airliner pays both airports' owners the same amount on arrival", async () => {
    const { game, p1, p2, a1, a2 } = await airportGame();
    const p1Before = p1.gold();
    const p2Before = p2.gold();

    game.addExecution(new CommercialAircraftExecution(a1, a2));
    for (
      let i = 0;
      i < 400 && game.units(UnitType.CommercialAircraft).length === 0;
      i++
    ) {
      game.executeNextTick();
    }
    expect(flightsOf(game).length).toBe(1);
    for (let i = 0; i < 400 && flightsOf(game).length > 0; i++) {
      game.executeNextTick();
    }

    const dist = game.manhattanDist(a1.tile(), a2.tile());
    const expected = game
      .config()
      .commercialAircraftGold(dist, p1, game.season());
    expect(expected).toBeGreaterThan(0n);
    expect(p1.gold() - p1Before).toBe(expected);
    expect(p2.gold() - p2Before).toBe(expected);
  });

  test("no airliner without a trading partner", async () => {
    const game = await setup(MAP, { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
      new PlayerInfo("p2", PlayerType.Human, null, "p2"),
    ]);
    executeTicks(game, 50);
    const p1 = game.player("p1");
    p1.conquer(game.ref(2, 2));
    p1.buildUnit(UnitType.Airport, game.ref(2, 2), {});

    // Only one airport on the map, owned by one player: nothing to fly to.
    executeTicks(game, 300);
    expect(flightsOf(game).length).toBe(0);
  });

  test("a player's own airports fly traffic between them, unpaid", async () => {
    const game = await setup(MAP, { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
      new PlayerInfo("p2", PlayerType.Human, null, "p2"),
    ]);
    executeTicks(game, 50);
    const p1 = game.player("p1");
    p1.conquer(game.ref(2, 2));
    p1.conquer(game.ref(2, 10));
    const a1 = p1.buildUnit(UnitType.Airport, game.ref(2, 2), {});
    const a2 = p1.buildUnit(UnitType.Airport, game.ref(2, 10), {});
    const before = p1.gold();

    game.addExecution(new CommercialAircraftExecution(a1, a2));
    for (
      let i = 0;
      i < 400 && game.units(UnitType.CommercialAircraft).length === 0;
      i++
    ) {
      game.executeNextTick();
    }
    expect(flightsOf(game).length).toBe(1);
    for (let i = 0; i < 400 && flightsOf(game).length > 0; i++) {
      game.executeNextTick();
    }
    expect(flightsOf(game).length).toBe(0);
    expect(p1.gold()).toBe(before);
  });

  test("the dispatch cap holds the number of airliners in flight", async () => {
    const { game, a1, a2 } = await airportGame();
    // Airports dispatch through their own execution, added when built.
    game.addExecution(new AirportExecution(a1));
    game.addExecution(new AirportExecution(a2));
    const cap = game.config().commercialAircraftCap();
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      game.executeNextTick();
      peak = Math.max(peak, flightsOf(game).length);
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(cap);
  });

  test("a destination lost mid-flight ends the trip without payment", async () => {
    const { game, p1, a1, a2 } = await airportGame();
    game.addExecution(new CommercialAircraftExecution(a1, a2));
    for (let i = 0; i < 400 && flightsOf(game).length === 0; i++) {
      game.executeNextTick();
    }
    expect(flightsOf(game).length).toBe(1);
    const goldBefore = p1.gold();

    a2.delete(false);
    executeTicks(game, 5);

    expect(flightsOf(game).length).toBe(0);
    expect(p1.gold()).toBe(goldBefore);
  });

  test("a flight in progress round-trips through a snapshot", async () => {
    const { game, a1, a2 } = await airportGame();
    game.addExecution(new CommercialAircraftExecution(a1, a2));
    await expectSnapshotRoundTrip(game, MAP, 3);
    executeTicks(game, 6);
    await expectSnapshotRoundTrip(game, MAP, 40);
  });
});
