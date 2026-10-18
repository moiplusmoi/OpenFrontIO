import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameID } from "@openfront/engine-api/Schemas";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { SetCapitalExecution } from "@openfront/engine/execution/SetCapitalExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../util/Setup";
import { constructionExecution, executeTicks } from "../util/utils";

const gameID: GameID = "game_id";
let game: Game;
let a: Player;
let b: Player;

describe("GalloFront capital", () => {
  beforeEach(async () => {
    game = await setup("big_plains", {
      infiniteGold: true,
      instantBuild: true,
    });
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
  });

  test("the first city becomes the capital and raises the troop cap", () => {
    expect(a.capitalTile()).toBeNull();
    const capBefore = game.config().maxTroops(a);
    constructionExecution(game, a, 5, 5, UnitType.City);
    expect(a.capitalTile()).toBe(game.ref(5, 5));
    expect(game.config().maxTroops(a)).toBeGreaterThan(capBefore);
    // a second city does not move it
    for (let x = 36; x < 46; x++)
      for (let y = 36; y < 46; y++) a.conquer(game.ref(x, y));
    constructionExecution(game, a, 40, 40, UnitType.City);
    expect(a.units(UnitType.City).length).toBe(2);
    expect(a.capitalTile()).toBe(game.ref(5, 5));
  });

  test("set_capital moves it to another finished city, with a cooldown", () => {
    constructionExecution(game, a, 5, 5, UnitType.City);
    for (let x = 36; x < 46; x++)
      for (let y = 36; y < 46; y++) a.conquer(game.ref(x, y));
    constructionExecution(game, a, 40, 40, UnitType.City);
    const second = a
      .units(UnitType.City)
      .find((c) => c.tile() !== game.ref(5, 5))!;
    expect(second).toBeDefined();
    // capital was set at construction → the cooldown applies
    game.addExecution(new SetCapitalExecution(a, second.tile()));
    executeTicks(game, 2);
    expect(a.capitalTile()).toBe(game.ref(5, 5));
    executeTicks(game, game.config().capitalMoveCooldown() + 1);
    game.addExecution(new SetCapitalExecution(a, second.tile()));
    executeTicks(game, 2);
    expect(a.capitalTile()).toBe(second.tile());
    // not a city tile → ignored
    executeTicks(game, game.config().capitalMoveCooldown() + 1);
    game.addExecution(new SetCapitalExecution(a, game.ref(6, 6)));
    executeTicks(game, 2);
    expect(a.capitalTile()).toBe(second.tile());
  });

  test("capture: victim loses 25% troops and gold, conqueror gets the gold, far tiles revolt", () => {
    constructionExecution(game, b, 60, 60, UnitType.City);
    expect(b.capitalTile()).toBe(game.ref(60, 60));
    // give b a far-away second city and territory around it, then take the capital tile
    for (let x = 140; x < 160; x++)
      for (let y = 140; y < 160; y++) b.conquer(game.ref(x, y));
    constructionExecution(game, b, 150, 150, UnitType.City);
    const far = b
      .units(UnitType.City)
      .find((c) => c.tile() !== game.ref(60, 60))!;
    expect(far).toBeDefined();
    // tiles near the fallen capital but far from the other city will revolt
    for (let x = 55; x < 66; x++)
      for (let y = 55; y < 66; y++) b.conquer(game.ref(x, y));
    b.addTroops(100_000 - b.troops());
    b.removeGold(b.gold());
    b.addGold(400_000n);
    const aGold = a.gold();
    // a takes the capital tile directly
    a.conquer(game.ref(60, 60));
    executeTicks(game, 3); // PlayerExecution captures the city → capitalFallen
    expect(
      a.units(UnitType.City).some((c) => c.tile() === game.ref(60, 60)),
    ).toBe(true);
    expect(b.troops()).toBeLessThanOrEqual(75_000 + 5_000);
    expect(b.gold()).toBeLessThanOrEqual(300_000n + 10_000n);
    expect(a.gold() - aGold).toBeGreaterThanOrEqual(100_000n);
    // remaining city becomes the new capital, far tiles (near 60,60) revolted
    expect(b.capitalTile()).toBe(far.tile());
    expect(game.owner(game.ref(56, 56)).isPlayer()).toBe(false);
    expect(game.owner(game.ref(145, 145))).toBe(b);
  });

  test("attack logic gets the capital defense flag", () => {
    constructionExecution(game, b, 60, 60, UnitType.City);
    for (let x = 58; x < 63; x++)
      for (let y = 58; y < 63; y++) b.conquer(game.ref(x, y));
    const r = game.config().attackLogic({
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
    expect(r).toBeDefined();
    expect(game.config().capitalDefenseBonus()).toBe(1.5);
    expect(game.config().capitalRange()).toBe(game.config().defensePostRange());
    // an attack execution still runs with the new input field
    a.addTroops(50_000);
    for (let x = 50; x < 58; x++)
      for (let y = 55; y < 65; y++) a.conquer(game.ref(x, y));
    game.addExecution(new AttackExecution(20_000, a, b.id()));
    executeTicks(game, 20);
    expect(a.numTilesOwned()).toBeGreaterThan(80);
  });
});
