import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { GameID } from "@openfront/engine-api/Schemas";
import {
  Season,
  SEASON_CYCLE_TICKS,
  SEASON_TICKS,
  seasonAt,
  seasonProgress,
} from "@openfront/engine-lib/game/Seasons";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../util/Setup";
import { expectSnapshotRoundTrip } from "../util/Snapshot";
import { executeTicks } from "../util/utils";

const gameID: GameID = "game_id";

describe("GalloFront seasons", () => {
  test("season is a pure function of the tick", () => {
    expect(seasonAt(0)).toBe(Season.Spring);
    expect(seasonAt(SEASON_TICKS)).toBe(Season.Summer);
    expect(seasonAt(2 * SEASON_TICKS)).toBe(Season.Autumn);
    expect(seasonAt(3 * SEASON_TICKS)).toBe(Season.Winter);
    expect(seasonAt(SEASON_CYCLE_TICKS)).toBe(Season.Spring);
    expect(seasonProgress(SEASON_TICKS / 2)).toBeCloseTo(0.5, 6);
  });

  test("winter slows growth, summer boosts gold; disabled games have no season", async () => {
    const game: Game = await setup("big_plains", {});
    const info = new PlayerInfo("p", PlayerType.Human, null, "p");
    game.addPlayer(info);
    game.addExecution(
      new SpawnExecution(gameID, game.player(info.id).info(), game.ref(5, 5)),
    );
    executeTicks(game, 3);
    const p: Player = game.player("p");
    expect(game.season()).toBe(Season.Spring);
    const cfg = game.config();
    expect(cfg.troopIncreaseRate(p, Season.Winter)).toBeCloseTo(
      cfg.troopIncreaseRate(p, Season.Spring) * 0.7,
      5,
    );
    expect(Number(cfg.goldAdditionRate(p, Season.Summer))).toBe(
      Math.floor(Number(cfg.goldAdditionRate(p, null)) * 1.1),
    );
    expect(cfg.seasonConstructionMult(Season.Spring)).toBe(0.8);
    expect(cfg.seasonTradeMult(Season.Autumn)).toBe(1.15);
    const off: Game = await setup("big_plains", { seasons: false });
    expect(off.season()).toBeNull();
  });

  test("snapshots across a season change stay in sync", async () => {
    const game: Game = await setup("big_plains", {});
    const info = new PlayerInfo("p", PlayerType.Human, null, "p");
    game.addPlayer(info);
    game.addExecution(
      new SpawnExecution(gameID, game.player(info.id).info(), game.ref(5, 5)),
    );
    executeTicks(game, SEASON_TICKS - 20);
    await expectSnapshotRoundTrip(game, "big_plains", 60);
  });
});
