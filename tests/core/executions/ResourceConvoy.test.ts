import {
  PlayerInfo,
  PlayerType,
  ResourceType,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import {
  ResourceConvoyExecution,
  SendConvoyExecution,
} from "@openfront/engine/execution/ResourceConvoyExecution";
import { TrainStationExecution } from "@openfront/engine/execution/TrainStationExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import type { TileRef } from "@openfront/engine-api/game/GameMap";
import { setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";
import { executeTicks } from "../../util/utils";

// Convoys move a stock from one owned structure to another. Each mode has its
// own route: rail between stations, sea between ports, air between airports.

const PLAINS = "plains";
const WORLD = "world";
const MAX_TICKS = 3000;

async function game(
  map: string,
): Promise<{ game: Game; p1: Player; p2: Player }> {
  const g = await setup(map, { instantBuild: true }, [
    new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    new PlayerInfo("p2", PlayerType.Human, null, "p2"),
  ]);
  executeTicks(g, 50);
  const p1 = g.player("p1");
  const p2 = g.player("p2");
  return { game: g, p1, p2 };
}

function own(
  g: Game,
  p: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) p.conquer(g.ref(x, y));
  }
}

function grantMil2(p: Player) {
  for (const t of [TechId.Mil1, TechId.Mil2]) {
    p.startResearch(t, 0);
    p.completeResearch();
  }
}

function convoy(
  g: Game,
  p: Player,
  src: Unit,
  dst: Unit,
  resource: ResourceType,
  amount: number,
  mode: "rail" | "sea" | "air",
) {
  g.addExecution(
    new SendConvoyExecution(p, src.id(), dst.id(), resource, amount, mode),
  );
}

/** Ticks until the destination has received the cargo, or gives up. */
function runUntil(g: Game, done: () => boolean): void {
  for (let i = 0; i < MAX_TICKS && !done(); i++) g.executeNextTick();
}

describe("resource convoys by rail", () => {
  test("a train carries oil from one city to another and the stock moves", async () => {
    const { game: g, p1 } = await game(PLAINS);
    own(g, p1, 0, 0, 60, 60);
    const from = p1.buildUnit(UnitType.City, g.ref(10, 10), {});
    const to = p1.buildUnit(UnitType.City, g.ref(30, 12), {});
    g.addExecution(
      new TrainStationExecution(from, true),
      new TrainStationExecution(to),
    );
    executeTicks(g, 5);
    from.addStock(ResourceType.Oil, 100);

    convoy(g, p1, from, to, ResourceType.Oil, 40, "rail");
    runUntil(g, () => to.stock(ResourceType.Oil) > 0);

    expect(to.stock(ResourceType.Oil)).toBe(40);
    expect(from.stock(ResourceType.Oil)).toBe(60);
  });
});

describe("resource convoys by sea", () => {
  test("a ship carries metal from one port to another on the same sea", async () => {
    // The world map is large enough for two ports far apart on one coast.
    const { game: g, p1 } = await game(WORLD);
    p1.addGold(10_000_000n);
    let anchor: TileRef | null = null;
    g.map().forEachTile((t) => {
      if (anchor === null && g.isLand(t) && g.isShore(t)) anchor = t;
    });
    expect(anchor, "a shore").not.toBeNull();
    const at = anchor!;
    // Own the land around the anchor so both ports can stand on it.
    const box = 60;
    for (let x = g.x(at) - box; x <= g.x(at) + box; x++) {
      for (let y = g.y(at) - box; y <= g.y(at) + box; y++) {
        if (!g.isValidCoord(x, y)) continue;
        const t = g.ref(x, y);
        if (g.isLand(t)) p1.conquer(t);
      }
    }
    g.addExecution(new ConstructionExecution(p1, UnitType.Port, at));
    executeTicks(g, 3);
    const [from] = p1.units(UnitType.Port);
    const water = g.getWaterComponent(from.tile());
    let toTile: TileRef | undefined;
    for (
      let x = g.x(at) - box;
      x <= g.x(at) + box && toTile === undefined;
      x++
    ) {
      for (
        let y = g.y(at) - box;
        y <= g.y(at) + box && toTile === undefined;
        y++
      ) {
        if (!g.isValidCoord(x, y)) continue;
        const t = g.ref(x, y);
        if (
          g.isLand(t) &&
          g.isShore(t) &&
          g.manhattanDist(t, from.tile()) >= 40 &&
          water !== null &&
          g.hasWaterComponent(t, water) &&
          p1.canBuild(UnitType.Port, t) !== false
        ) {
          toTile = t;
        }
      }
    }
    expect(toTile, "a second shore on the same sea").toBeDefined();
    g.addExecution(new ConstructionExecution(p1, UnitType.Port, toTile!));
    executeTicks(g, 3);
    const to = p1.units(UnitType.Port).find((u) => u !== from)!;

    from.addStock(ResourceType.Metal, 30);
    convoy(g, p1, from, to, ResourceType.Metal, 30, "sea");
    runUntil(g, () => to.stock(ResourceType.Metal) > 0);

    expect(to.stock(ResourceType.Metal)).toBe(30);
    expect(from.stock(ResourceType.Metal)).toBe(0);
  }, 120_000);
});

describe("resource convoys by air", () => {
  test("a cargo plane carries food between two airports", async () => {
    const { game: g, p1 } = await game(PLAINS);
    own(g, p1, 0, 0, 60, 60);
    p1.startResearch(TechId.Mil1, 0);
    p1.completeResearch();
    p1.startResearch(TechId.Mil2, 0);
    p1.completeResearch();
    const from = p1.buildUnit(UnitType.Airport, g.ref(10, 10), {});
    const to = p1.buildUnit(UnitType.Airport, g.ref(40, 10), {});
    from.addStock(ResourceType.Food, 50);

    convoy(g, p1, from, to, ResourceType.Food, 50, "air");
    runUntil(g, () => to.stock(ResourceType.Food) > 0);

    expect(to.stock(ResourceType.Food)).toBe(50);
    expect(from.stock(ResourceType.Food)).toBe(0);
  });
});

describe("resource convoy safety", () => {
  test("cargo that does not fit at the destination goes back to the source", async () => {
    const { game: g, p1 } = await game(PLAINS);
    own(g, p1, 0, 0, 60, 60);
    p1.startResearch(TechId.Mil1, 0);
    p1.completeResearch();
    p1.startResearch(TechId.Mil2, 0);
    p1.completeResearch();
    const from = p1.buildUnit(UnitType.Airport, g.ref(10, 10), {});
    const to = p1.buildUnit(UnitType.Airport, g.ref(40, 10), {});
    from.addStock(ResourceType.Food, 50);
    to.addStock(ResourceType.Food, g.config().resourceStockCapacity() - 5);

    convoy(g, p1, from, to, ResourceType.Food, 20, "air");
    executeTicks(g, 200);

    expect(to.stock(ResourceType.Food)).toBe(
      g.config().resourceStockCapacity(),
    );
    // 20 left home: 15 came back, 5 went in.
    expect(from.stock(ResourceType.Food)).toBe(50 - 20 + 15);
  });

  test("a convoy whose destination is lost brings its cargo home", async () => {
    const { game: g, p1 } = await game(PLAINS);
    own(g, p1, 0, 0, 60, 60);
    p1.startResearch(TechId.Mil1, 0);
    p1.completeResearch();
    p1.startResearch(TechId.Mil2, 0);
    p1.completeResearch();
    const from = p1.buildUnit(UnitType.Airport, g.ref(10, 10), {});
    const to = p1.buildUnit(UnitType.Airport, g.ref(40, 10), {});
    from.addStock(ResourceType.Food, 50);

    convoy(g, p1, from, to, ResourceType.Food, 50, "air");
    executeTicks(g, 3);
    to.delete(false);
    executeTicks(g, 3);

    expect(from.stock(ResourceType.Food)).toBe(50);
  });

  test("an embargo keeps a convoy from reaching another player", async () => {
    const { game: g, p1, p2 } = await game(PLAINS);
    own(g, p1, 0, 0, 30, 60);
    own(g, p2, 31, 0, 60, 60);
    grantMil2(p1);
    const mine = p1.buildUnit(UnitType.Airport, g.ref(10, 10), {});
    const theirs = p2.buildUnit(UnitType.Airport, g.ref(40, 10), {});
    p2.addGold(10_000_000n);
    p1.addEmbargo(p2, false);
    mine.addStock(ResourceType.Food, 50);

    convoy(g, p1, mine, theirs, ResourceType.Food, 50, "air");
    executeTicks(g, 200);

    expect(mine.stock(ResourceType.Food)).toBe(50);
    expect(theirs.stock(ResourceType.Food)).toBe(0);
  });

  test("a sale: the buyer pays the price per unit and the seller is paid", async () => {
    const { game: g, p1, p2 } = await game(PLAINS);
    own(g, p1, 0, 0, 30, 60);
    own(g, p2, 31, 0, 60, 60);
    grantMil2(p1);
    const seller = p1.buildUnit(UnitType.Airport, g.ref(10, 10), {});
    const buyer = p2.buildUnit(UnitType.Airport, g.ref(40, 10), {});
    seller.addStock(ResourceType.Food, 50);
    p2.addGold(10_000_000n);
    const price = g.config().resourcePrice(ResourceType.Food);
    const buyerGold = p2.gold();
    const sellerGold = p1.gold();

    convoy(g, p1, seller, buyer, ResourceType.Food, 20, "air");
    runUntil(g, () => buyer.stock(ResourceType.Food) > 0);

    expect(buyer.stock(ResourceType.Food)).toBe(20);
    expect(p2.gold()).toBe(buyerGold - price * 20n);
    expect(p1.gold()).toBe(sellerGold + price * 20n);
  });

  test("a buyer who cannot pay receives nothing and the cargo goes home", async () => {
    const { game: g, p1, p2 } = await game(PLAINS);
    own(g, p1, 0, 0, 30, 60);
    own(g, p2, 31, 0, 60, 60);
    grantMil2(p1);
    const seller = p1.buildUnit(UnitType.Airport, g.ref(10, 10), {});
    const buyer = p2.buildUnit(UnitType.Airport, g.ref(40, 10), {});
    seller.addStock(ResourceType.Food, 50);
    // Broke: zero gold, so not even one unit can be paid for.
    expect(p2.gold()).toBe(0n);

    convoy(g, p1, seller, buyer, ResourceType.Food, 20, "air");
    executeTicks(g, 200);

    expect(buyer.stock(ResourceType.Food)).toBe(0);
    expect(seller.stock(ResourceType.Food)).toBe(50);
  });

  test("a convoy in flight survives a snapshot round trip", async () => {
    const { game: g, p1 } = await game(PLAINS);
    own(g, p1, 0, 0, 60, 60);
    p1.startResearch(TechId.Mil1, 0);
    p1.completeResearch();
    p1.startResearch(TechId.Mil2, 0);
    p1.completeResearch();
    const from = p1.buildUnit(UnitType.Airport, g.ref(10, 10), {});
    const to = p1.buildUnit(UnitType.Airport, g.ref(40, 10), {});
    from.addStock(ResourceType.Food, 50);

    convoy(g, p1, from, to, ResourceType.Food, 50, "air");
    executeTicks(g, 4);
    await expectSnapshotRoundTrip(g, PLAINS, 30);
  });
});
