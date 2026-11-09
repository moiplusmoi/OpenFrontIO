import {
  PlayerInfo,
  PlayerType,
  ResourceType,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

// Player-ordered naval builds go through ConstructionExecution, the same path
// as a click in the build menu. The other submarine/carrier tests call
// buildUnit directly, which skips this dispatch and so never caught the gap.

const MAP = "half_land_half_ocean";
// On this map row, land runs through column 7 and open sea starts at column 8.
const SHORE_X = 7;
const WATER_X = 8;
const ROW = 10;

async function seaGame(): Promise<{ game: Game; p1: Player }> {
  const game = await setup(MAP, { instantBuild: true }, [
    new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    new PlayerInfo("p2", PlayerType.Human, null, "p2"),
  ]);
  executeTicks(game, 50);
  const p1 = game.player("p1");
  // A player with no territory counts as dead and cannot build anything, so
  // spawn it on land first, as a real game does.
  // Spawn inland on the shore row so the player's territory covers the coast.
  game.addExecution(
    new SpawnExecution("game_id", p1.info(), game.ref(SHORE_X - 2, ROW)),
  );
  executeTicks(game, 3);
  p1.addGold(10_000_000n);
  // Naval units spawn from one of the owner's ports in the same water body.
  // Build the port the way a player does, so PortExecution runs and keeps it.
  game.addExecution(
    new ConstructionExecution(p1, UnitType.Port, game.ref(SHORE_X, ROW)),
  );
  executeTicks(game, 5);
  return { game, p1 };
}

// Tech is granted the way the other tests do it: research completed at once.
function grant(player: Player, ...techs: TechId[]) {
  for (const tech of techs) {
    player.startResearch(tech, 0);
    player.completeResearch();
  }
}

describe("player-ordered naval construction", () => {
  test("a submarine ordered from the build menu is actually built", async () => {
    const { game, p1 } = await seaGame();
    // No technology, only the second era: three techs owned.
    grant(p1, TechId.Eco1, TechId.Eco2, TechId.Eco3);
    p1.addResource(ResourceType.Oil, 50);

    game.addExecution(
      new ConstructionExecution(p1, UnitType.Submarine, game.ref(WATER_X, ROW)),
    );
    executeTicks(game, 5);

    expect(p1.units(UnitType.Submarine).length).toBe(1);
  });

  test("a carrier ordered from the build menu is actually built", async () => {
    const { game, p1 } = await seaGame();
    // Aviation (mil_3) plus era 3 (six techs owned).
    grant(
      p1,
      TechId.Mil1,
      TechId.Mil2,
      TechId.Mil3,
      TechId.Eco1,
      TechId.Def1,
      TechId.Def2,
    );
    p1.addResource(ResourceType.Oil, 100);
    p1.addResource(ResourceType.Metal, 50);

    game.addExecution(
      new ConstructionExecution(p1, UnitType.Carrier, game.ref(WATER_X, ROW)),
    );
    executeTicks(game, 5);

    expect(p1.units(UnitType.Carrier).length).toBe(1);
  });

  test("a submarine is refused without the oil it costs", async () => {
    const { game, p1 } = await seaGame();
    grant(p1, TechId.Eco1, TechId.Eco2, TechId.Eco3);

    game.addExecution(
      new ConstructionExecution(p1, UnitType.Submarine, game.ref(WATER_X, ROW)),
    );
    executeTicks(game, 5);

    expect(p1.units(UnitType.Submarine).length).toBe(0);
  });

  test("a submarine is refused in the first era", async () => {
    const { game, p1 } = await seaGame();

    game.addExecution(
      new ConstructionExecution(p1, UnitType.Submarine, game.ref(WATER_X, ROW)),
    );
    executeTicks(game, 5);

    expect(p1.units(UnitType.Submarine).length).toBe(0);
  });

  test("a carrier is refused in the third era without Aviation", async () => {
    const { game, p1 } = await seaGame();
    // Six techs (era 3) but no mil_3: the carrier still waits.
    grant(
      p1,
      TechId.Eco1,
      TechId.Eco2,
      TechId.Eco3,
      TechId.Eco4,
      TechId.Def1,
      TechId.Def2,
    );

    game.addExecution(
      new ConstructionExecution(p1, UnitType.Carrier, game.ref(WATER_X, ROW)),
    );
    executeTicks(game, 5);

    expect(p1.units(UnitType.Carrier).length).toBe(0);
  });
});
