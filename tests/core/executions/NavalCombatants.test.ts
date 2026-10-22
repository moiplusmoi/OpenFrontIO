import {
  PlayerInfo,
  PlayerType,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";
import { executeTicks } from "../../util/utils";

// Frigates and destroyers patrol and fight like warships. These tests pin the
// per-type numbers and the parts that differ: cost, tech gate, speed, snapshots.

const MAP = "half_land_half_ocean";
// Water starts just past this column.
const coastX = 7;

async function navalGame(
  opts: { infiniteGold: boolean } = { infiniteGold: true },
): Promise<{ game: Game; p1: Player }> {
  const game = await setup(MAP, { ...opts, instantBuild: true }, [
    new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    new PlayerInfo("p2", PlayerType.Human, null, "p2"),
  ]);
  // Past the warship's manual-move retreat lockout.
  executeTicks(game, 50);
  const p1 = game.player("p1");
  p1.conquer(game.ref(coastX, 10));
  p1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
  return { game, p1 };
}

describe("naval combatants: stats", () => {
  test("each combatant has its own health", async () => {
    const { game } = await navalGame();
    expect(game.config().unitInfo(UnitType.Warship).maxHealth).toBe(1000);
    expect(game.config().unitInfo(UnitType.Frigate).maxHealth).toBe(500);
    expect(game.config().unitInfo(UnitType.Destroyer).maxHealth).toBe(2200);
  });

  test("traits: frigates are fast and light, destroyers slow and heavy", async () => {
    const { game } = await navalGame();
    const config = game.config();
    expect(config.navalTraits(UnitType.Warship)).toEqual({
      stepsPerTick: 1,
      moveEveryTicks: 1,
      shellDamagePct: 100,
    });
    expect(config.navalTraits(UnitType.Frigate)).toEqual({
      stepsPerTick: 2,
      moveEveryTicks: 1,
      shellDamagePct: 60,
    });
    expect(config.navalTraits(UnitType.Destroyer)).toEqual({
      stepsPerTick: 1,
      moveEveryTicks: 2,
      shellDamagePct: 150,
    });
  });

  test("destroyers need Offensive Doctrine (mil_2); frigates need no tech", async () => {
    const { game } = await navalGame();
    expect(game.config().unitRequiredTech(UnitType.Destroyer)).toBe(
      TechId.Mil2,
    );
    expect(game.config().unitRequiredTech(UnitType.Frigate)).toBeNull();
  });
});

describe("naval combatants: cost", () => {
  // Human players with infiniteGold pay nothing, so price tests run without it.
  async function pricedGame() {
    const { game, p1 } = await navalGame({ infiniteGold: false });
    p1.addGold(10_000_000n);
    return { game, p1 };
  }

  test("frigate cost rises with each frigate afloat, up to its cap", async () => {
    const { game, p1 } = await pricedGame();
    const cost = game.unitInfo(UnitType.Frigate).cost;
    expect(cost(game, p1)).toBe(100_000n);
    p1.buildUnit(UnitType.Frigate, game.ref(coastX + 1, 10), {
      patrolTile: game.ref(coastX + 1, 10),
    });
    expect(cost(game, p1)).toBe(200_000n);
  });

  test("destroyer cost starts at 600k and rises by 300k per destroyer", async () => {
    const { game, p1 } = await pricedGame();
    const cost = game.unitInfo(UnitType.Destroyer).cost;
    expect(cost(game, p1)).toBe(600_000n);
    p1.buildUnit(UnitType.Destroyer, game.ref(coastX + 1, 10), {
      patrolTile: game.ref(coastX + 1, 10),
    });
    expect(cost(game, p1)).toBe(900_000n);
  });

  test("the warship cost is unchanged by the new ships", async () => {
    const { game, p1 } = await pricedGame();
    p1.buildUnit(UnitType.Frigate, game.ref(coastX + 1, 10), {
      patrolTile: game.ref(coastX + 1, 10),
    });
    expect(game.unitInfo(UnitType.Warship).cost(game, p1)).toBe(250_000n);
  });
});

describe("naval combatants: behaviour", () => {
  test("a built frigate or destroyer keeps its own type and gets warship state", async () => {
    const { game, p1 } = await navalGame();
    const frigate = p1.buildUnit(UnitType.Frigate, game.ref(coastX + 1, 10), {
      patrolTile: game.ref(coastX + 1, 10),
    });
    const destroyer = p1.buildUnit(
      UnitType.Destroyer,
      game.ref(coastX + 1, 11),
      { patrolTile: game.ref(coastX + 1, 11) },
    );
    expect(frigate.type()).toBe(UnitType.Frigate);
    expect(destroyer.type()).toBe(UnitType.Destroyer);
    expect(frigate.warshipState().state).toBe("patrolling");
    expect(destroyer.warshipState().state).toBe("patrolling");
  });

  test("a destroyer only moves on every other tick", async () => {
    const { game, p1 } = await navalGame();
    const destroyer = p1.buildUnit(
      UnitType.Destroyer,
      game.ref(coastX + 1, 10),
      { patrolTile: game.ref(coastX + 1, 10) },
    );
    game.addExecution(new WarshipExecution(destroyer));

    const movedOn: number[] = [];
    let previous = destroyer.tile();
    for (let i = 0; i < 12; i++) {
      game.executeNextTick();
      if (destroyer.tile() !== previous) {
        movedOn.push(game.ticks());
        previous = destroyer.tile();
      }
    }

    expect(movedOn.length).toBeGreaterThan(0);
    // Every move lands on the same parity of tick: one move every two ticks.
    const parity = movedOn[0] % 2;
    expect(movedOn.every((t) => t % 2 === parity)).toBe(true);
    expect(movedOn.length).toBeLessThanOrEqual(6);
  });
});

describe("naval combatants: snapshots", () => {
  test("pending frigate and destroyer executions round-trip", async () => {
    const { game, p1 } = await navalGame();
    game.addExecution(
      new WarshipExecution({
        owner: p1,
        patrolTile: game.ref(coastX + 4, 4),
        unitType: UnitType.Frigate,
      }),
    );
    game.addExecution(
      new WarshipExecution({
        owner: p1,
        patrolTile: game.ref(coastX + 4, 6),
        unitType: UnitType.Destroyer,
      }),
    );
    // Pending: built from params on init.
    await expectSnapshotRoundTrip(game, MAP, 30);
    expect(p1.units(UnitType.Frigate).length).toBe(1);
    // No Offensive Doctrine yet: the destroyer cannot be built, so it stays pending.
    expect(p1.units(UnitType.Destroyer).length).toBe(0);
    await expectSnapshotRoundTrip(game, MAP, 30);
  });
});
