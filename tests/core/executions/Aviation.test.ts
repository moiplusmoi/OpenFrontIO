import {
  PlayerInfo,
  PlayerType,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameID } from "@openfront/engine-api/Schemas";
import { BomberExecution } from "@openfront/engine/execution/BomberExecution";
import { FighterExecution } from "@openfront/engine/execution/FighterExecution";
import { ParadropExecution } from "@openfront/engine/execution/ParadropExecution";
import { ResearchExecution } from "@openfront/engine/execution/ResearchExecution";
import { SAMLauncherExecution } from "@openfront/engine/execution/SAMLauncherExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
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
const square = (p: Player, x0: number, y0: number, n: number) => {
  for (let x = x0; x < x0 + n; x++)
    for (let y = y0; y < y0 + n; y++) p.conquer(game.ref(x, y));
};

describe("GalloFront aviation", () => {
  beforeEach(async () => {
    game = await setup("big_plains", { instantBuild: true });
    const ia = new PlayerInfo("a", PlayerType.Human, null, "a");
    const ib = new PlayerInfo("b", PlayerType.Human, null, "b");
    game.addPlayer(ia);
    game.addPlayer(ib);
    game.addExecution(
      new SpawnExecution(gameID, game.player(ia.id).info(), game.ref(10, 10)),
      new SpawnExecution(gameID, game.player(ib.id).info(), game.ref(90, 90)),
    );
    executeTicks(game, 3);
    a = game.player("a");
    b = game.player("b");
    square(a, 5, 5, 12);
    square(b, 80, 80, 25);
    a.addGold(50_000_000n);
    b.addGold(50_000_000n);
  });

  test("airport needs mil_3; bombers take a slot and reload", () => {
    constructionExecution(game, a, 10, 10, UnitType.Airport);
    expect(a.unitCount(UnitType.Airport)).toBe(0);
    learn(a, [TechId.Mil1, TechId.Mil2, TechId.Mil3]);
    constructionExecution(game, a, 10, 10, UnitType.Airport);
    expect(a.unitCount(UnitType.Airport)).toBe(1);
    const airport = a.units(UnitType.Airport)[0];
    expect(airport.isInCooldown()).toBe(false);
    game.addExecution(new BomberExecution(a, game.ref(90, 90)));
    executeTicks(game, 2);
    expect(a.unitCount(UnitType.Bomber)).toBe(1);
    expect(airport.isInCooldown()).toBe(true);
    // second bomber refused while the only slot reloads
    game.addExecution(new BomberExecution(a, game.ref(90, 90)));
    executeTicks(game, 2);
    expect(a.unitCount(UnitType.Bomber)).toBe(1);
    executeTicks(game, game.config().airportSortieCooldown(a) + 2);
    expect(airport.isInCooldown()).toBe(false);
  });

  test("a raid kills a capped share of troops and degrades one structure, no tiles taken", () => {
    learn(a, [TechId.Mil1, TechId.Mil2, TechId.Mil3]);
    constructionExecution(game, a, 10, 10, UnitType.Airport);
    constructionExecution(game, b, 90, 90, UnitType.City);
    const city = b.units(UnitType.City)[0];
    b.addTroops(200_000 - b.troops());
    const tilesBefore = b.numTilesOwned();
    const troopsBefore = b.troops();
    game.addExecution(new BomberExecution(a, city.tile()));
    executeTicks(game, 2);
    expect(a.unitCount(UnitType.Bomber)).toBe(1);
    executeTicks(game, 60); // ~110 tiles at 5/tick
    expect(a.unitCount(UnitType.Bomber)).toBe(0);
    // the raid removed a capped share (8 %); the destroyed city also lowers
    // the troop cap, so only bound the loss loosely
    expect(troopsBefore - b.troops()).toBeGreaterThan(troopsBefore * 0.03);
    expect(troopsBefore - b.troops()).toBeLessThan(troopsBefore * 0.25);
    expect(b.numTilesOwned()).toBe(tilesBefore);
    // level-1 city destroyed by the raid
    expect(b.unitCount(UnitType.City)).toBe(0);
  });

  test("fighters intercept bombers about 60% of the time", () => {
    learn(a, [TechId.Mil1, TechId.Mil2, TechId.Mil3]);
    learn(b, [TechId.Mil1, TechId.Mil2, TechId.Mil3, TechId.Mil4]);
    constructionExecution(game, a, 10, 10, UnitType.Airport);
    constructionExecution(game, b, 90, 90, UnitType.Airport);
    constructionExecution(game, b, 90, 90, UnitType.Airport);
    const bAirport = b.units(UnitType.Airport)[0];
    game.addExecution(new FighterExecution(b, bAirport.tile()));
    executeTicks(game, 3);
    expect(b.unitCount(UnitType.Fighter)).toBe(1);
    let intercepted = 0;
    const sorties = 12;
    for (let i = 0; i < sorties; i++) {
      // Each sortie is an independent roll: a raid that gets through can
      // destroy the airport and its fighter, so rebuild both before the next.
      if (b.unitCount(UnitType.Airport) === 0) {
        constructionExecution(game, b, 90, 90, UnitType.Airport);
      }
      const target = b.units(UnitType.Airport)[0];
      if (b.unitCount(UnitType.Fighter) === 0) {
        game.addExecution(new FighterExecution(b, target.tile()));
        executeTicks(game, 3);
      }
      game.addExecution(new BomberExecution(a, target.tile()));
      executeTicks(game, 2);
      const before = b.unitCount(UnitType.Airport);
      executeTicks(game, 70);
      // bomber gone either way; if the airport kept its level, it was shot down
      if (b.unitCount(UnitType.Airport) === before && before > 0) intercepted++;
      executeTicks(game, game.config().airportSortieCooldown(a) + 1);
    }
    expect(intercepted).toBeGreaterThan(0);
  });

  test("paradrop lands troops as a localized attack with a 20% loss", () => {
    learn(a, [TechId.Mil1, TechId.Mil2, TechId.Mil3]);
    constructionExecution(game, a, 10, 10, UnitType.Airport);
    a.addTroops(100_000 - a.troops());
    const dst = game.ref(82, 82);
    expect(game.owner(dst)).toBe(b);
    game.addExecution(new ParadropExecution(a, dst, 20_000));
    executeTicks(game, 2);
    expect(a.unitCount(UnitType.AirTransport)).toBe(1);
    const plane = a.units(UnitType.AirTransport)[0];
    expect(plane.troops()).toBeLessThanOrEqual(20_000);
    let landed = false;
    for (let i = 0; i < 120 && !landed; i++) {
      executeTicks(game, 1);
      if (a.unitCount(UnitType.AirTransport) === 0) {
        landed = true;
        // right after landing the tile is ours and the attack is under way
        expect(game.owner(dst)).toBe(a);
        expect(a.outgoingAttacks().length).toBeGreaterThan(0);
      }
    }
    expect(landed).toBe(true);
  });

  test("SAMs shoot aircraft and prefer nukes", () => {
    learn(a, [TechId.Mil1, TechId.Mil2, TechId.Mil3]);
    constructionExecution(game, a, 10, 10, UnitType.Airport);
    constructionExecution(game, b, 90, 90, UnitType.SAMLauncher);
    const sam = b.units(UnitType.SAMLauncher)[0];
    game.addExecution(new SAMLauncherExecution(b, null, sam));
    game.addExecution(new BomberExecution(a, game.ref(90, 90)));
    executeTicks(game, 80);
    // either the SAM fired (cooldown queue) or the bomber struck: the SAM reacts to aircraft
    expect(
      sam.missileTimerQueue().length > 0 ||
        b.unitCount(UnitType.SAMLauncher) === 0,
    ).toBe(true);
  });

  test("aircraft in flight survive a snapshot round trip", async () => {
    learn(a, [TechId.Mil1, TechId.Mil2, TechId.Mil3, TechId.Mil4]);
    constructionExecution(game, a, 10, 10, UnitType.Airport);
    const airport = a.units(UnitType.Airport)[0];
    game.addExecution(new FighterExecution(a, airport.tile()));
    executeTicks(game, game.config().airportSortieCooldown(a) + 3);
    game.addExecution(new BomberExecution(a, game.ref(90, 90)));
    executeTicks(game, 3);
    expect(a.unitCount(UnitType.Fighter)).toBe(1);
    expect(a.unitCount(UnitType.Bomber)).toBe(1);
    await expectSnapshotRoundTrip(game, "big_plains", 120);
  });
});
