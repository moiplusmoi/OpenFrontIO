import {
  PlayerInfo,
  PlayerType,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { isSubmarineDetectedBy } from "@openfront/engine/game/Submarines";
import { setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";
import { executeTicks } from "../../util/utils";

// Submarines stay hidden from enemies until a surface ship or port of theirs
// is within sonar range; a detected submarine is a normal target.

const MAP = "half_land_half_ocean";
// Sonar needs 35+ tiles of room; big_plains is 200 tiles wide. Units are placed
// with buildUnit, which does not check terrain, so the land is only a canvas.
const WIDE_MAP = "big_plains";
// Water starts just past column 7; this row is open sea for the whole test.
const ROW = 10;
const WATER_X = 10;

async function seaGame(
  map = MAP,
): Promise<{ game: Game; p1: Player; p2: Player }> {
  const game = await setup(map, { instantBuild: true }, [
    new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    new PlayerInfo("p2", PlayerType.Human, null, "p2"),
  ]);
  executeTicks(game, 50);
  return { game, p1: game.player("p1"), p2: game.player("p2") };
}

function surfaceShip(game: Game, owner: Player, x: number): Unit {
  return owner.buildUnit(UnitType.Warship, game.ref(x, ROW), {
    patrolTile: game.ref(x, ROW),
  });
}

function submarine(game: Game, owner: Player, x: number): Unit {
  return owner.buildUnit(UnitType.Submarine, game.ref(x, ROW), {
    patrolTile: game.ref(x, ROW),
  });
}

describe("submarine detection", () => {
  test("an enemy sees a submarine exactly within sonar range of a surface ship", async () => {
    const { game, p1, p2 } = await seaGame(WIDE_MAP);
    const range = game.config().submarineDetectionRange();
    expect(range).toBe(35);

    surfaceShip(game, p1, WATER_X);
    const near = submarine(game, p2, WATER_X + range);
    const far = submarine(game, p2, WATER_X + range + 1);

    expect(isSubmarineDetectedBy(near, p1, game)).toBe(true);
    expect(isSubmarineDetectedBy(far, p1, game)).toBe(false);
  });

  test("ports detect submarines too", async () => {
    const { game, p1, p2 } = await seaGame(WIDE_MAP);
    const range = game.config().submarineDetectionRange();
    p1.buildUnit(UnitType.Port, game.ref(WATER_X, ROW), {});
    const sub = submarine(game, p2, WATER_X + range);
    expect(isSubmarineDetectedBy(sub, p1, game)).toBe(true);
  });

  test("the owner always sees its own submarine", async () => {
    const { game, p2 } = await seaGame();
    const sub = submarine(game, p2, WATER_X);
    expect(isSubmarineDetectedBy(sub, p2, game)).toBe(true);
  });

  test("an enemy with no surface ship nearby does not see it", async () => {
    const { game, p1, p2 } = await seaGame();
    const sub = submarine(game, p2, WATER_X);
    expect(isSubmarineDetectedBy(sub, p1, game)).toBe(false);
  });
});

describe("submarine stats", () => {
  test("health, sonar tech and price", async () => {
    const { game, p1 } = await seaGame();
    expect(game.config().unitInfo(UnitType.Submarine).maxHealth).toBe(600);
    expect(game.config().unitRequiredTech(UnitType.Submarine)).toBe(
      TechId.Def2,
    );
    expect(game.config().navalTraits(UnitType.Submarine).shellDamagePct).toBe(
      40,
    );
    // Priced: human players with infinite gold pay nothing.
    expect(game.unitInfo(UnitType.Submarine).cost(game, p1)).toBeGreaterThan(
      0n,
    );
  });
});

describe("submarine snapshots", () => {
  test("a pending submarine execution round-trips", async () => {
    const { game, p1 } = await seaGame();
    game.addExecution(
      new WarshipExecution({
        owner: p1,
        patrolTile: game.ref(WATER_X + 4, ROW),
        unitType: UnitType.Submarine,
      }),
    );
    await expectSnapshotRoundTrip(game, MAP, 30);
  });
});
