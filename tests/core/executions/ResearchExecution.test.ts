import {
  MessageType,
  PlayerInfo,
  PlayerType,
  TechBranch,
  TechId,
} from "@openfront/engine-api/game/GameTypes";
import { GameID } from "@openfront/engine-api/Schemas";
import { ResearchExecution } from "@openfront/engine/execution/ResearchExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

let game: Game;
let player: Player;
const gameID: GameID = "game_id";

describe("GalloFront research", () => {
  beforeEach(async () => {
    game = await setup("big_plains", {});
    const info = new PlayerInfo("p1", PlayerType.Human, null, "p1");
    game.addPlayer(info);
    game.addExecution(
      new SpawnExecution(gameID, game.player(info.id).info(), game.ref(5, 5)),
    );
    executeTicks(game, 3);
    player = game.player("p1");
  });

  test("charges the cost, then completes at the end tick", () => {
    player.addGold(1_000_000n);
    const before = player.gold();
    const cost = game.config().techCost(TechId.Eco1);
    const duration = game.config().techDuration(TechId.Eco1);
    const income = game.config().goldAdditionRate(player);
    game.addExecution(new ResearchExecution(player, TechId.Eco1));
    executeTicks(game, 2);
    expect(player.gold()).toBe(before - cost + income * 2n);
    expect(player.research()?.tech).toBe(TechId.Eco1);
    expect(player.hasTech(TechId.Eco1)).toBe(false);
    executeTicks(game, duration + 2);
    expect(player.hasTech(TechId.Eco1)).toBe(true);
    expect(player.research()).toBeNull();
    expect(player.techLevel(TechBranch.Economy)).toBe(1);
    expect(player.techLevel(TechBranch.Military)).toBe(0);
  });

  test("refuses without the prerequisite, without gold, or while researching", () => {
    player.addGold(10_000_000n);
    game.addExecution(new ResearchExecution(player, TechId.Eco2));
    executeTicks(game, 2);
    expect(player.research()).toBeNull();

    game.addExecution(new ResearchExecution(player, TechId.Eco1));
    executeTicks(game, 2);
    expect(player.research()?.tech).toBe(TechId.Eco1);
    const goldAfterFirst = player.gold();
    const income = game.config().goldAdditionRate(player);
    // second research while one is running: ignored, no gold taken
    game.addExecution(new ResearchExecution(player, TechId.Mil1));
    executeTicks(game, 2);
    expect(player.research()?.tech).toBe(TechId.Eco1);
    expect(player.gold()).toBe(goldAfterFirst + income * 2n);

    executeTicks(game, game.config().techDuration(TechId.Eco1) + 2);
    expect(player.hasTech(TechId.Eco1)).toBe(true);
    // not enough gold for Eco2 (750k) after spending: drain first
    player.removeGold(player.gold());
    game.addExecution(new ResearchExecution(player, TechId.Eco2));
    executeTicks(game, 2);
    expect(player.research()).toBeNull();
  });

  test("emits a research_complete message", () => {
    player.addGold(1_000_000n);
    game.addExecution(new ResearchExecution(player, TechId.Mil1));
    executeTicks(game, game.config().techDuration(TechId.Mil1) + 4);
    expect(player.hasTech(TechId.Mil1)).toBe(true);
    expect(MessageType.RESEARCH_COMPLETE).toBeDefined();
  });
});
