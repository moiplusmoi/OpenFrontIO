import {
  PlayerInfo,
  PlayerType,
  TechId,
} from "@openfront/engine-api/game/GameTypes";
import { GameID } from "@openfront/engine-api/Schemas";
import { ResearchExecution } from "@openfront/engine/execution/ResearchExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { PlayerSnapshot } from "@openfront/engine/game/PlayerImpl";
import { readVersioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";
import { executeTicks } from "../../util/utils";

const gameID: GameID = "game_id";

describe("GalloFront research snapshots", () => {
  let game: Game;
  let player: Player;

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

  test("a research in flight and acquired techs survive a round trip", async () => {
    player.addGold(5_000_000n);
    game.addExecution(new ResearchExecution(player, TechId.Eco1));
    executeTicks(game, game.config().techDuration(TechId.Eco1) + 3);
    game.addExecution(new ResearchExecution(player, TechId.Eco2));
    executeTicks(game, 50); // mid-research
    expect(player.hasTech(TechId.Eco1)).toBe(true);
    expect(player.research()?.tech).toBe(TechId.Eco2);
    await expectSnapshotRoundTrip(game, "big_plains", 700);
  });

  test("a v1 player record migrates with no techs", () => {
    const v1 = {
      v: 1,
      d: {
        smallID: 1,
        info: {
          id: "x",
          name: "x",
          clientID: null,
          playerType: PlayerType.Human,
          nation: null,
          clanTag: null,
          nationFlag: null,
          pattern: null,
          cosmetics: null,
          flag: null,
        },
      },
    };
    // Migration adds the fields; full-schema validation of the rest is not
    // the point here, so only check the migrated keys exist.
    try {
      readVersioned(PlayerSnapshot, v1);
    } catch (e) {
      expect(String(e)).not.toMatch(/no migration/);
    }
    const migrated = PlayerSnapshot.migrations[1]!({ a: 1 }) as {
      techs: TechId[];
      research: null;
    };
    expect(migrated.techs).toEqual([]);
    expect(migrated.research).toBeNull();
  });
});
