import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  NationSpyBehavior,
  SPY_ATTACK_TICK_INTERVAL,
} from "@openfront/engine/execution/nation/NationSpyBehavior";
import { Game, Player } from "@openfront/engine/game/Game";
import { describe, expect, it } from "vitest";
import { createGame, L } from "./core/pathfinding/_fixtures";

// GalloFront: nations send spies through NationSpyBehavior. Only Hard and
// Impossible nations with the Intelligence technology do; they steal from a
// rich neighbor and, on Impossible, sabotage a SAM covering a nuke target.

const SIZE = 60;
/** How often NationExecution calls maybeSpy (an attack tick). */
const ATTACK_RATE = 40;

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
    victimGold = 0n,
    def3 = true,
  }: { nationGold?: bigint; victimGold?: bigint; def3?: boolean } = {},
): {
  game: Game;
  nation: Player;
  victim: Player;
  behavior: NationSpyBehavior;
} {
  const grid: string[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) grid.push(L);
  const game = createGame({ width: SIZE, height: SIZE, grid }, { difficulty });
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
  for (let i = 0; i < 3; i++) {
    nation.buildUnit(UnitType.City, game.ref(5 + 8 * i, 5), {});
    victim.buildUnit(UnitType.City, game.ref(SIZE - 5 - 8 * i, 5), {});
  }
  if (def3) grant(nation, TechId.Def1, TechId.Def2, TechId.Def3);
  nation.addGold(nationGold);
  victim.addGold(victimGold);
  const behavior = new NationSpyBehavior(new PseudoRandom(7), game, nation);
  return { game, nation, victim, behavior };
}

/** Runs `ticks` ticks, calling maybeSpy every attack tick; the tick a spy appeared. */
function runUntilSpy(
  game: Game,
  nation: Player,
  behavior: NationSpyBehavior,
  ticks: number,
): number | null {
  for (let i = 0; i < ticks; i++) {
    if (i % ATTACK_RATE === 0) behavior.maybeSpy();
    game.executeNextTick();
    if (nation.unitCount(UnitType.Spy) > 0) return i;
  }
  return null;
}

describe("NationSpyBehavior", () => {
  it("Easy never sends a spy, even rich and with the technology", () => {
    const { game, nation, behavior } = setupNations(Difficulty.Easy, {
      nationGold: 100_000_000n,
      victimGold: 100_000_000n,
    });
    expect(runUntilSpy(game, nation, behavior, 2_000)).toBeNull();
    expect(nation.unitCount(UnitType.Spy)).toBe(0);
  });

  it("Impossible with def_3 and gold steals from a rich neighbor", () => {
    const { game, nation, victim, behavior } = setupNations(
      Difficulty.Impossible,
      { nationGold: 10_000_000n, victimGold: 100_000_000n },
    );
    expect(behavior.stealTarget()).toBe(victim);
    const at = runUntilSpy(game, nation, behavior, 2_000);
    expect(at).not.toBeNull();
    expect(nation.unitCount(UnitType.Spy)).toBeGreaterThan(0);
    // Acts on every fourth attack tick, not the first one.
    expect(at!).toBeGreaterThanOrEqual(
      ATTACK_RATE * (SPY_ATTACK_TICK_INTERVAL - 1),
    );
  });

  it("does not spy without def_3, without the reserve or on a poor target", () => {
    const noTech = setupNations(Difficulty.Impossible, {
      nationGold: 10_000_000n,
      victimGold: 100_000_000n,
      def3: false,
    });
    expect(
      runUntilSpy(noTech.game, noTech.nation, noTech.behavior, 800),
    ).toBeNull();

    const poor = setupNations(Difficulty.Hard, {
      nationGold: 1_000_000n, // below 4 spy costs
      victimGold: 100_000_000n,
    });
    expect(runUntilSpy(poor.game, poor.nation, poor.behavior, 800)).toBeNull();

    const poorTarget = setupNations(Difficulty.Hard, {
      nationGold: 10_000_000n,
      victimGold: 1_000_000n, // not worth a steal
    });
    expect(poorTarget.behavior.stealTarget()).toBeNull();
    expect(
      runUntilSpy(poorTarget.game, poorTarget.nation, poorTarget.behavior, 800),
    ).toBeNull();
  });

  it("Impossible sabotages a SAM covering the enemy's structures when a silo is ready", () => {
    const { game, nation, victim, behavior } = setupNations(
      Difficulty.Impossible,
      { nationGold: 10_000_000n, victimGold: 0n },
    );
    const silo = nation.buildUnit(UnitType.MissileSilo, game.ref(10, 30), {});
    silo.setUnderConstruction(false);
    const sam = victim.buildUnit(
      UnitType.SAMLauncher,
      game.ref(SIZE - 6, 7),
      {},
    );
    sam.setUnderConstruction(false);
    expect(behavior.sabotageTarget()).toBe(sam);
    expect(runUntilSpy(game, nation, behavior, 2_000)).not.toBeNull();
    // Hard doesn't sabotage, and with no target worth stealing from, sends nothing.
    const hard = setupNations(Difficulty.Hard, { nationGold: 10_000_000n });
    const hardSilo = hard.nation.buildUnit(
      UnitType.MissileSilo,
      hard.game.ref(10, 30),
      {},
    );
    hardSilo.setUnderConstruction(false);
    const hardSam = hard.victim.buildUnit(
      UnitType.SAMLauncher,
      hard.game.ref(SIZE - 6, 7),
      {},
    );
    hardSam.setUnderConstruction(false);
    expect(runUntilSpy(hard.game, hard.nation, hard.behavior, 800)).toBeNull();
  });
});
