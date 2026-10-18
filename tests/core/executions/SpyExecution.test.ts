import {
  PlayerInfo,
  PlayerType,
  SpyMission,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameID } from "@openfront/engine-api/Schemas";
import { ResearchExecution } from "@openfront/engine/execution/ResearchExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { SpyExecution } from "@openfront/engine/execution/SpyExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";
import { constructionExecution, executeTicks } from "../../util/utils";

const gameID: GameID = "game_id";
let game: Game;
let a: Player;
let b: Player;

function learn(p: Player, ids: TechId[]) {
  for (const id of ids) {
    p.addGold(game.config().techCost(id));
    game.addExecution(new ResearchExecution(p, id));
    executeTicks(game, game.config().techDuration(id) + 3);
    expect(p.hasTech(id)).toBe(true);
  }
}

describe("GalloFront spies", () => {
  beforeEach(async () => {
    game = await setup("big_plains", { instantBuild: true });
    const ia = new PlayerInfo("a", PlayerType.Human, null, "a");
    const ib = new PlayerInfo("b", PlayerType.Human, null, "b");
    game.addPlayer(ia);
    game.addPlayer(ib);
    game.addExecution(
      new SpawnExecution(gameID, game.player(ia.id).info(), game.ref(5, 5)),
      new SpawnExecution(gameID, game.player(ib.id).info(), game.ref(60, 60)),
    );
    executeTicks(game, 3);
    a = game.player("a");
    b = game.player("b");
    for (let x = 55; x < 66; x++)
      for (let y = 55; y < 66; y++) b.conquer(game.ref(x, y));
  });

  test("needs def_3, charges 300k and travels to the target", () => {
    a.addGold(10_000_000n);
    game.addExecution(new SpyExecution(a, b.id(), SpyMission.Steal));
    executeTicks(game, 2);
    expect(a.unitCount(UnitType.Spy)).toBe(0);
    learn(a, [TechId.Def1, TechId.Def2, TechId.Def3]);
    const gold = a.gold();
    game.addExecution(new SpyExecution(a, b.id(), SpyMission.Steal));
    executeTicks(game, 2);
    expect(a.unitCount(UnitType.Spy)).toBe(1);
    expect(gold - a.gold()).toBeGreaterThanOrEqual(300_000n - 1_000n);
    // cooldown: a second spy right away is refused
    game.addExecution(new SpyExecution(a, b.id(), SpyMission.Reveal));
    executeTicks(game, 2);
    expect(a.unitCount(UnitType.Spy)).toBe(1);
    executeTicks(game, 120);
    expect(a.unitCount(UnitType.Spy)).toBe(0); // arrived and resolved
  });

  test("steal moves at most 8% (capped) of the target's gold on success", () => {
    learn(a, [TechId.Def1, TechId.Def2, TechId.Def3]);
    a.addGold(10_000_000n);
    b.removeGold(b.gold());
    b.addGold(50_000_000n);
    let stolen = 0n;
    // several attempts (deterministic PRNG per tick): at least one succeeds
    for (let i = 0; i < 6; i++) {
      const before = b.gold();
      game.addExecution(new SpyExecution(a, b.id(), SpyMission.Steal));
      executeTicks(game, game.config().spyCooldown() + 5);
      const diff =
        before +
        game.config().goldAdditionRate(b) *
          BigInt(game.config().spyCooldown() + 5) -
        b.gold();
      if (diff > 0n) stolen += diff;
    }
    expect(stolen).toBeGreaterThan(0n);
    expect(stolen).toBeLessThanOrEqual(game.config().spyStealCap() * 6n);
  });

  test("sabotage disables a SAM for a while, reveal grants intel", () => {
    learn(a, [TechId.Def1, TechId.Def2, TechId.Def3]);
    a.addGold(10_000_000n);
    b.addGold(10_000_000n);
    constructionExecution(game, b, 60, 60, UnitType.SAMLauncher);
    const sam = b.units(UnitType.SAMLauncher)[0];
    expect(sam).toBeDefined();
    let sabotaged = false;
    for (let i = 0; i < 8 && !sabotaged; i++) {
      game.addExecution(
        new SpyExecution(a, b.id(), SpyMission.Sabotage, sam.id()),
      );
      executeTicks(game, game.config().spyCooldown() + 5);
      sabotaged = sam.isDisabled();
    }
    expect(sabotaged).toBe(true);
    let revealed = false;
    for (let i = 0; i < 8 && !revealed; i++) {
      game.addExecution(new SpyExecution(a, b.id(), SpyMission.Reveal));
      executeTicks(game, game.config().spyCooldown() + 5);
      revealed = a.intel().some((e) => e.target === b.smallID());
    }
    expect(revealed).toBe(true);
  });

  test("a spy in flight survives a snapshot round trip", async () => {
    learn(a, [TechId.Def1, TechId.Def2, TechId.Def3]);
    a.addGold(1_000_000n);
    game.addExecution(new SpyExecution(a, b.id(), SpyMission.Reveal));
    executeTicks(game, 5);
    expect(a.unitCount(UnitType.Spy)).toBe(1);
    await expectSnapshotRoundTrip(game, "big_plains", 200);
  });
});
