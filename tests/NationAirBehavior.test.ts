import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { NationAirBehavior } from "@openfront/engine/execution/nation/NationAirBehavior";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { Game, Player } from "@openfront/engine/game/Game";
import { describe, expect, it } from "vitest";
import { createGame, L } from "./core/pathfinding/_fixtures";

// GalloFront: nations fly through NationAirBehavior (bombers, fighters,
// paradrops) and build their airports through NationStructureBehavior's
// ratios. Only Hard and Impossible nations with Aviation (mil_3) do.

const SIZE = 60;
/** How often NationExecution calls the behaviors (an attack tick). */
const ATTACK_RATE = 40;
/** Cities per airport on Hard is 1 / 0.15, so 7 cities ask for one. */
const CITIES = 7;

function grant(player: Player, ...techs: TechId[]) {
  for (const tech of techs) {
    player.startResearch(tech, 0);
    player.completeResearch();
  }
}

function setupNations(
  difficulty: Difficulty,
  {
    nationGold = 0n,
    mil3 = true,
  }: { nationGold?: bigint; mil3?: boolean } = {},
): {
  game: Game;
  nation: Player;
  victim: Player;
  air: NationAirBehavior;
  structures: NationStructureBehavior;
} {
  const grid: string[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) grid.push(L);
  const game = createGame(
    { width: SIZE, height: SIZE, grid },
    {
      difficulty,
      instantBuild: true,
      // Only cities and airports, so the structure behavior gets to the
      // airport without first filling the map with the other structures.
      disabledUnits: [
        UnitType.Port,
        UnitType.Factory,
        UnitType.SAMLauncher,
        UnitType.MissileSilo,
        UnitType.DefensePost,
      ],
    },
  );
  const nation = game.addPlayer(
    new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
  );
  const victim = game.addPlayer(
    new PlayerInfo("victim", PlayerType.Human, "victim_client", "victim_id"),
  );
  // West half to the nation, east half to the victim: they are neighbors.
  game.map().forEachTile((tile) => {
    (game.x(tile) < SIZE / 2 ? nation : victim).conquer(tile);
  });
  game.endSpawnPhase();
  for (let i = 0; i < CITIES; i++) {
    nation.buildUnit(UnitType.City, game.ref(3 + 3 * i, 5), {});
  }
  for (let i = 0; i < 3; i++) {
    victim.buildUnit(UnitType.City, game.ref(SIZE - 5 - 8 * i, 5), {});
  }
  if (mil3) grant(nation, TechId.Mil1, TechId.Mil2, TechId.Mil3);
  nation.addGold(nationGold);
  nation.addTroops(200_000);
  victim.addTroops(200_000);
  const random = new PseudoRandom(7);
  const air = new NationAirBehavior(random, game, nation);
  const structures = new NationStructureBehavior(random, game, nation);
  return { game, nation, victim, air, structures };
}

/**
 * Runs `ticks` ticks, calling both behaviors every attack tick. Returns the
 * ticks the first airport and the first bomber appeared (null: never).
 */
function run(
  s: ReturnType<typeof setupNations>,
  ticks: number,
): { airport: number | null; bomber: number | null } {
  const out: { airport: number | null; bomber: number | null } = {
    airport: null,
    bomber: null,
  };
  for (let i = 0; i < ticks; i++) {
    if (i % ATTACK_RATE === 0) {
      s.structures.handleStructures();
      s.air.maybeAct();
    }
    s.game.executeNextTick();
    if (out.airport === null && s.nation.unitCount(UnitType.Airport) > 0) {
      out.airport = i;
    }
    if (out.bomber === null && s.nation.unitCount(UnitType.Bomber) > 0) {
      out.bomber = i;
    }
    if (out.airport !== null && out.bomber !== null) break;
  }
  return out;
}

describe("NationAirBehavior", () => {
  it("Hard with mil_3 and gold builds an airport, then bombs a neighbor", () => {
    const s = setupNations(Difficulty.Hard, { nationGold: 50_000_000n });
    const { airport, bomber } = run(s, 3_000);
    expect(airport).not.toBeNull();
    expect(bomber).not.toBeNull();
    expect(bomber!).toBeGreaterThan(airport!);
    expect(bomber!).toBeLessThan(3_000);
    // The bomber heads for the victim's land.
    const plane = s.nation.units(UnitType.Bomber)[0];
    const dst = plane.targetTile();
    expect(dst).toBeDefined();
    expect(s.game.owner(dst!)).toBe(s.victim);
    // The only airport's single slot is now reloading (30 s): nothing to
    // launch from until then.
    expect(s.air.bombTarget()).toBeNull();
  });

  it("Easy never builds an airport nor flies, even rich and with the technology", () => {
    const s = setupNations(Difficulty.Easy, { nationGold: 50_000_000n });
    const { airport, bomber } = run(s, 2_000);
    expect(airport).toBeNull();
    expect(bomber).toBeNull();
    expect(s.nation.unitCount(UnitType.Airport)).toBe(0);
  });

  it("does nothing without mil_3 (the structure loop skips the airport)", () => {
    const s = setupNations(Difficulty.Impossible, {
      nationGold: 50_000_000n,
      mil3: false,
    });
    const { airport, bomber } = run(s, 1_000);
    expect(airport).toBeNull();
    expect(bomber).toBeNull();
  });

  it("does not bomb below a bomber's cost, and bombs once it can afford one", () => {
    const s = setupNations(Difficulty.Hard, { nationGold: 0n });
    // An airport handed over, but only 300k gold: below a bomber (400k).
    s.nation.buildUnit(UnitType.Airport, s.game.ref(20, 30), {});
    s.nation.addGold(300_000n);
    const flyOnly = (ticks: number): boolean => {
      for (let i = 0; i < ticks; i++) {
        if (i % ATTACK_RATE === 0) s.air.maybeAct();
        s.game.executeNextTick();
        if (s.nation.unitCount(UnitType.Bomber) > 0) return true;
      }
      return false;
    };
    expect(flyOnly(400)).toBe(false);
    expect(s.air.bombTarget()).toBeNull(); // canBuild wants the gold too
    s.nation.addGold(5_000_000n);
    expect(s.air.bombTarget()).not.toBeNull();
    expect(flyOnly(ATTACK_RATE + 3)).toBe(true);
  });

  it("Impossible paradrops when no land neighbor can be attacked", () => {
    const grid: string[] = [];
    for (let i = 0; i < SIZE * SIZE; i++) grid.push(L);
    const game = createGame(
      { width: SIZE, height: SIZE, grid },
      { difficulty: Difficulty.Impossible, instantBuild: true },
    );
    const nation = game.addPlayer(
      new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
    );
    const victim = game.addPlayer(
      new PlayerInfo("victim", PlayerType.Human, "victim_client", "victim_id"),
    );
    // A strip of nobody's land between them: no shared border.
    game.map().forEachTile((tile) => {
      const x = game.x(tile);
      if (x < 20) nation.conquer(tile);
      else if (x >= 40) victim.conquer(tile);
    });
    game.endSpawnPhase();
    grant(nation, TechId.Mil1, TechId.Mil2, TechId.Mil3);
    nation.buildUnit(UnitType.Airport, game.ref(10, 30), {});
    nation.addGold(10_000_000n);
    nation.addTroops(300_000);
    expect(nation.nearby().some((p) => p === victim)).toBe(false);
    const air = new NationAirBehavior(new PseudoRandom(3), game, nation);
    let dropped: number | null = null;
    for (let i = 0; i < 600 && dropped === null; i++) {
      if (i % ATTACK_RATE === 0) air.maybeAct();
      game.executeNextTick();
      if (nation.unitCount(UnitType.AirTransport) > 0) dropped = i;
    }
    expect(dropped).not.toBeNull();
    const plane = nation.units(UnitType.AirTransport)[0];
    expect(game.owner(plane.targetTile()!)).toBe(victim);
    expect(plane.troops()).toBeGreaterThan(0);
  });
});
