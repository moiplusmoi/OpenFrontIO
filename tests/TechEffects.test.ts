import {
  PlayerInfo,
  PlayerType,
  TechBranch,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameID } from "@openfront/engine-api/Schemas";
import { ResearchExecution } from "@openfront/engine/execution/ResearchExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { Config } from "@openfront/engine-lib/configuration/Config";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let player: Player;
const gameID: GameID = "game_id";

async function research(ids: TechId[]) {
  for (const id of ids) {
    player.addGold(game.config().techCost(id));
    game.addExecution(new ResearchExecution(player, id));
    executeTicks(game, game.config().techDuration(id) + 3);
    expect(player.hasTech(id)).toBe(true);
  }
}

describe("GalloFront tech effects", () => {
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

  test("economy: worker gold ×1.15 then ×1.3, cheaper civil structures, bigger cap", async () => {
    const base = game.config().goldAdditionRate(player);
    const cityBase = game.unitInfo(UnitType.City).cost(game, player);
    const siloBase = game.unitInfo(UnitType.MissileSilo).cost(game, player);
    const capBase = game.config().maxTroops(player);
    await research([TechId.Eco1]);
    expect(Number(game.config().goldAdditionRate(player))).toBe(
      Math.floor(Number(base) * 1.15),
    );
    await research([TechId.Eco2, TechId.Eco3]);
    expect(game.unitInfo(UnitType.City).cost(game, player)).toBe(
      BigInt(Math.floor(Number(cityBase) * 0.85)),
    );
    expect(game.unitInfo(UnitType.MissileSilo).cost(game, player)).toBe(
      siloBase,
    );
    expect(game.config().maxTroops(player)).toBeCloseTo(capBase * 1.1, 0);
    await research([TechId.Eco4]);
    expect(Number(game.config().goldAdditionRate(player))).toBe(
      Math.floor(Number(base) * 1.3),
    );
    expect(player.techLevel(TechBranch.Economy)).toBe(4);
  });

  test("military: growth ×1.15, attack losses ×0.88, 4 boats, warship hp ×1.2", async () => {
    const boatsBase = game.config().boatMaxNumber(player);
    expect(game.config().techGrowthMult(player)).toBe(1);
    await research([TechId.Mil1]);
    expect(game.config().techGrowthMult(player)).toBe(1.15);
    // growth formula applies the multiplier before the (1 - troops/max) ratio
    const cfg = new Config(game.config().gameConfig(), false);
    const troops = player.troops();
    const max = cfg.maxTroops(player);
    const expected =
      (10 + Math.pow(troops, 0.73) / 4) * 1.15 * (1 - troops / max);
    expect(cfg.troopIncreaseRate(player)).toBeCloseTo(expected, 3);
    expect(game.config().boatMaxNumber(player)).toBe(boatsBase);
    await research([TechId.Mil2]);
    expect(game.config().boatMaxNumber(player)).toBe(boatsBase + 1);
    expect(game.config().techAttackerLossMult(2)).toBe(0.88);
    expect(game.config().techAttackSpeedMult(2)).toBe(0.92);
    expect(game.config().techWarshipHealthMult(player)).toBe(1.2);
  });

  test("defense: defender losses ×0.85, SAM range ×1.15 and cooldown 70", async () => {
    const cfg = new Config(game.config().gameConfig(), false);
    expect(game.config().SAMCooldown(player)).toBe(90);
    await research([TechId.Def1]);
    expect(game.config().techDefenderLossMult(1)).toBe(0.85);
    expect(cfg.samRange(1, 1)).toBe(cfg.samRange(1));
    await research([TechId.Def2]);
    expect(cfg.samRange(1, 2)).toBeCloseTo(cfg.samRange(1) * 1.15, 5);
    expect(game.config().SAMCooldown(player)).toBe(70);
  });

  test("attack logic applies the tech multipliers (none = unchanged)", () => {
    const engine = new EngineConfig(game.config().gameConfig(), false);
    const r = engine.attackLogic({
      terrain: 0 as never,
      attackTroops: 1000,
      attacker: { type: PlayerType.Human, numTiles: 100 },
      defender: {
        type: PlayerType.Human,
        numTiles: 100,
        troops: 1000,
        isTraitor: false,
        isDisconnectedTeammate: false,
      },
      defenderHasDefensePost: false,
      falloutRatio: null,
      borderSize: 10,
    });
    const r2 = engine.attackLogic({
      terrain: 0 as never,
      attackTroops: 1000,
      attacker: { type: PlayerType.Human, numTiles: 100 },
      defender: {
        type: PlayerType.Human,
        numTiles: 100,
        troops: 1000,
        isTraitor: false,
        isDisconnectedTeammate: false,
      },
      defenderHasDefensePost: false,
      falloutRatio: null,
      borderSize: 10,
      attackerMilitaryTech: 2,
      defenderDefenseTech: 1,
    });
    expect(r2.attackerTroopLoss).toBeCloseTo(r.attackerTroopLoss * 0.88, 6);
    expect(r2.defenderTroopLoss).toBeCloseTo(r.defenderTroopLoss * 0.85, 6);
    expect(r2.tickFraction).toBeCloseTo(r.tickFraction * 0.92, 6);
  });
});
