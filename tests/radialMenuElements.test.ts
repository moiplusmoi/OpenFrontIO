// @vitest-environment jsdom
import { vi } from "vitest";

// Mock BuildMenu to avoid importing lit and other ESM-heavy deps in this unit test
vi.mock("../src/client/hud/layers/BuildMenu", () => ({
  BuildMenu: class {},
  flattenedBuildTable: [],
}));

// Mock Utils to avoid touching DOM (document) during tests
vi.mock("../src/client/Utils", () => ({
  translateText: (k: string) => k,
  getSvgAspectRatio: async () => 1,
}));

import {
  COLORS,
  rootMenuElement,
  type MenuElementParams,
} from "../src/client/hud/layers/RadialMenuElements";
import { SendSetCapitalIntentEvent } from "../src/client/Transport";

// Minimal stubs to satisfy types used in rootMenuElement.subMenu and allyBreak actions
const makePlayer = (
  id: string,
  opts?: { isTraitor?: boolean; isDisconnected?: boolean },
) =>
  ({
    id: () => id,
    isAlliedWith: (other: any) =>
      other && typeof other.id === "function" && other.id() !== id
        ? true
        : true,
    isTraitor: () => opts?.isTraitor ?? false,
    isDisconnected: () => opts?.isDisconnected ?? false,
  }) as unknown as import("../src/client/view").PlayerView;

const makeParams = (opts?: Partial<MenuElementParams>): MenuElementParams => {
  const myPlayer = (opts?.myPlayer as any) ?? makePlayer("p1");
  const selected = (opts?.selected as any) ?? makePlayer("p2");
  return {
    myPlayer,
    selected,
    tile: {} as any,
    playerActions: {
      canAttack: true,
      interaction: {
        canBreakAlliance: true,
        canSendAllianceRequest: false,
        canEmbargo: false,
      },
    } as any,
    game: {
      inSpawnPhase: () => false,
      owner: () => ({ isPlayer: () => false }),
    } as any,
    buildMenu: {
      canBuildOrUpgrade: () => false,
      cost: () => 0,
      count: () => 0,
      sendBuildOrUpgrade: () => {},
    } as any,
    emojiTable: {} as any,
    playerActionHandler: {
      handleBreakAlliance: vi.fn(),
      handleEmbargo: vi.fn(),
      handleDonateGold: vi.fn(),
      handleDonateTroops: vi.fn(),
      handleTargetPlayer: vi.fn(),
    } as any,
    playerPanel: {
      show: vi.fn(),
    } as any,
    chatIntegration: {
      createQuickChatMenu: vi.fn(() => []),
    } as any,
    eventBus: {} as any,
    closeMenu: vi.fn(),
  };
};

const findAllyBreak = (items: any[]) =>
  items.find((i) => i && i.id === "ally_break");

describe("RadialMenuElements ally break", () => {
  test("shows break option with correct color when allied", () => {
    const params = makeParams();
    const items = rootMenuElement.subMenu!(params);
    const ally = findAllyBreak(items)!;
    expect(ally).toBeTruthy();
    expect(ally.name).toBe("break");
    expect(typeof ally.color).toBe("function");
    expect(ally.color(params)).toBe(COLORS.breakAlly);
  });

  test("shows break option with orange color when allied to traitor", () => {
    const params = makeParams({
      selected: makePlayer("p2", { isTraitor: true }),
    });
    const items = rootMenuElement.subMenu!(params);
    const ally = findAllyBreak(items)!;
    expect(ally.color(params)).toBe(COLORS.breakAllyNoDebuff);
  });

  test("shows boat button instead of break when allied to disconnected player", () => {
    const params = makeParams({
      selected: makePlayer("p2", { isDisconnected: true }),
    });
    const items = rootMenuElement.subMenu!(params);
    expect(findAllyBreak(items)).toBeUndefined();
    expect(items.find((i) => i.id === "boat")).toBeDefined();
  });

  test("break action calls handleBreakAlliance and closes menu", () => {
    const params = makeParams();
    const items = rootMenuElement.subMenu!(params);
    const ally = findAllyBreak(items)!;

    ally.action!(params);

    expect(params.playerActionHandler.handleBreakAlliance).toHaveBeenCalledWith(
      params.myPlayer,
      params.selected,
    );
    expect(params.closeMenu).toHaveBeenCalled();
  });
});

// ─── GalloFront: set capital ────────────────────────────────────────────────

const makeCity = (tile: number) => ({
  type: () => "City",
  tile: () => tile,
  isUnderConstruction: () => false,
  markedForDeletion: () => false as const,
});

const makeOwnTerritoryParams = (opts: {
  cities?: ReturnType<typeof makeCity>[];
  capitalTile?: number | null;
}) => {
  const myPlayer = {
    ...makePlayer("p1"),
    isPlayer: () => true,
    units: () => opts.cities ?? [],
    capitalTile: () => opts.capitalTile ?? null,
    deleteUnitCooldown: () => 0,
  };
  const emit = vi.fn();
  const params = makeParams({
    myPlayer: myPlayer as any,
    selected: myPlayer as any,
  });
  params.tile = 100 as any;
  params.game = {
    inSpawnPhase: () => false,
    isLand: () => true,
    owner: () => myPlayer,
    myPlayer: () => myPlayer,
    manhattanDist: (a: number, b: number) => Math.abs(a - b),
  } as any;
  params.playerActions = {
    canAttack: false,
    buildableUnits: [],
    interaction: {
      canBreakAlliance: false,
      canSendAllianceRequest: false,
      canEmbargo: false,
    },
  } as any;
  params.eventBus = { emit } as any;
  return { params, emit };
};

const findSetCapital = (items: any[]) =>
  items.find((i) => i && i.id === "set_capital");

describe("RadialMenuElements set capital", () => {
  test("is absent on own territory without a city nearby", () => {
    const { params } = makeOwnTerritoryParams({ cities: [makeCity(200)] });
    expect(findSetCapital(rootMenuElement.subMenu!(params))).toBeUndefined();
  });

  test("is offered and enabled on a city that isn't the capital", () => {
    const { params } = makeOwnTerritoryParams({
      cities: [makeCity(102)],
      capitalTile: null,
    });
    const item = findSetCapital(rootMenuElement.subMenu!(params));
    expect(item).toBeDefined();
    expect(item.disabled(params)).toBe(false);
  });

  test("is disabled on the current capital", () => {
    const { params } = makeOwnTerritoryParams({
      cities: [makeCity(102)],
      capitalTile: 102,
    });
    const item = findSetCapital(rootMenuElement.subMenu!(params));
    expect(item.disabled(params)).toBe(true);
  });

  test("action sends a set_capital intent for the closest city and closes", () => {
    const { params, emit } = makeOwnTerritoryParams({
      cities: [makeCity(104), makeCity(101)],
      capitalTile: 104,
    });
    const item = findSetCapital(rootMenuElement.subMenu!(params));
    item.action(params);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBeInstanceOf(SendSetCapitalIntentEvent);
    expect(emit.mock.calls[0][0].tile).toBe(101);
    expect(params.closeMenu).toHaveBeenCalled();
  });
});

// ─── GalloFront: spy ────────────────────────────────────────────────────────

import { SendSpyIntentEvent } from "../src/client/Transport";

const makeStructure = (id: number, type: string, tile: number) => ({
  id: () => id,
  type: () => type,
  tile: () => tile,
  isUnderConstruction: () => false,
  markedForDeletion: () => false as const,
});

const makeEnemyParams = (opts: {
  def3?: boolean;
  gold?: bigint;
  spies?: number;
  structures?: ReturnType<typeof makeStructure>[];
  alive?: boolean;
  friendly?: boolean;
}) => {
  const myPlayer = {
    ...makePlayer("p1"),
    isAlliedWith: () => false,
    hasTech: (id: string) => (opts.def3 ?? true) && id === "def_3",
    gold: () => opts.gold ?? 1_000_000n,
    units: (...types: string[]) =>
      types.includes("Spy") ? new Array(opts.spies ?? 0).fill({}) : [],
  };
  const enemy = {
    ...makePlayer("p2"),
    isPlayer: () => true,
    isAlliedWith: () => false,
    isAlive: () => opts.alive ?? true,
    isFriendly: () => opts.friendly ?? false,
    units: (...types: string[]) =>
      (opts.structures ?? []).filter((s) => types.includes(s.type())),
  };
  const emit = vi.fn();
  const params = makeParams({
    myPlayer: myPlayer as any,
    selected: enemy as any,
  });
  params.tile = 100 as any;
  params.game = {
    inSpawnPhase: () => false,
    isLand: () => true,
    owner: () => enemy,
    myPlayer: () => myPlayer,
    manhattanDist: (a: number, b: number) => Math.abs(a - b),
    config: () => ({ maxSpies: () => 3 }),
  } as any;
  params.playerActions = {
    canAttack: true,
    buildableUnits: [{ type: "Spy", cost: 300_000n, canBuild: false }],
    interaction: {
      canBreakAlliance: false,
      canSendAllianceRequest: true,
      canEmbargo: true,
    },
  } as any;
  params.eventBus = { emit } as any;
  return { params, emit };
};

const findSpy = (items: any[]) => items.find((i) => i && i.id === "spy");

// ─── GalloFront: paradrop ───────────────────────────────────────────────────

import { SendParadropIntentEvent } from "../src/client/Transport";

/** The attack submenu on an enemy's land, with or without a ready airport. */
const makeParadropParams = (opts: { ready?: boolean; land?: boolean }) => {
  const { params, emit } = makeEnemyParams({});
  (params.myPlayer as any).troops = () => 10_000;
  params.uiState = { attackRatio: 0.3 } as any;
  (params.game as any).isLand = () => opts.land ?? true;
  (params.game as any).config = () => ({ isUnitDisabled: () => false });
  params.playerActions.buildableUnits = [
    { type: "Air Transport", cost: 150_000n, canBuild: opts.ready ? 7 : false },
  ] as any;
  const attack = rootMenuElement.subMenu!(params).find(
    (i) => i.id === "attack",
  )!;
  return { params, emit, items: attack.subMenu!(params) };
};

const findParadrop = (items: any[]) =>
  items.find((i) => i && i.id === "paradrop");

describe("RadialMenuElements paradrop", () => {
  test("is in the attack submenu on land, disabled without a ready airport", () => {
    const { params, items } = makeParadropParams({ ready: false });
    const drop = findParadrop(items);
    expect(drop).toBeDefined();
    expect(drop.disabled(params)).toBe(true);
    expect(drop.color(params)).toBe(COLORS.disabled);
    drop.action(params);
    expect(params.closeMenu).toHaveBeenCalled();
  });

  test("is not offered on water", () => {
    const { items } = makeParadropParams({ ready: true, land: false });
    expect(findParadrop(items)).toBeUndefined();
  });

  test("sends the attack ratio of my troops to the clicked tile", () => {
    const { params, emit, items } = makeParadropParams({ ready: true });
    const drop = findParadrop(items);
    expect(drop.disabled(params)).toBe(false);
    expect(drop.color(params)).toBe(COLORS.attack);
    drop.action(params);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBeInstanceOf(SendParadropIntentEvent);
    expect(emit.mock.calls[0][0]).toMatchObject({ dst: 100, troops: 3_000 });
    expect(params.closeMenu).toHaveBeenCalledTimes(1);
  });
});

describe("RadialMenuElements spy", () => {
  test("is absent on allies, the dead and on the legacy stubs", () => {
    expect(findSpy(rootMenuElement.subMenu!(makeParams()))).toBeUndefined();
    const ally = makeEnemyParams({ friendly: true });
    expect(findSpy(rootMenuElement.subMenu!(ally.params))).toBeUndefined();
    const dead = makeEnemyParams({ alive: false });
    expect(findSpy(rootMenuElement.subMenu!(dead.params))).toBeUndefined();
  });

  test("is offered on a living enemy with three missions", () => {
    const { params } = makeEnemyParams({});
    const spy = findSpy(rootMenuElement.subMenu!(params));
    expect(spy).toBeDefined();
    expect(spy.disabled(params)).toBe(false);
    const missions = spy.subMenu(params).map((m: any) => m.id);
    expect(missions).toEqual(["spy_reveal", "spy_steal", "spy_sabotage"]);
  });

  test("is disabled without def_3, without 300k gold or with 3 spies out", () => {
    for (const opts of [{ def3: false }, { gold: 200_000n }, { spies: 3 }]) {
      const { params } = makeEnemyParams(opts);
      const spy = findSpy(rootMenuElement.subMenu!(params));
      expect(spy.disabled(params)).toBe(true);
      expect(spy.color(params)).toBe(COLORS.disabled);
    }
  });

  test("reveal and steal send a spy intent without a unit and close", () => {
    const { params, emit } = makeEnemyParams({});
    const [reveal, steal] = findSpy(rootMenuElement.subMenu!(params)).subMenu(
      params,
    );
    reveal.action(params);
    steal.action(params);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0][0]).toBeInstanceOf(SendSpyIntentEvent);
    expect(emit.mock.calls[0][0]).toMatchObject({
      targetID: "p2",
      mission: "reveal",
      unitId: undefined,
    });
    expect(emit.mock.calls[1][0]).toMatchObject({
      targetID: "p2",
      mission: "steal",
    });
    expect(params.closeMenu).toHaveBeenCalledTimes(2);
  });

  test("sabotage needs a structure within reach and targets the closest", () => {
    const none = makeEnemyParams({
      structures: [makeStructure(1, "SAM Launcher", 120)],
    });
    const far = findSpy(rootMenuElement.subMenu!(none.params)).subMenu(
      none.params,
    )[2];
    expect(far.disabled(none.params)).toBe(true);
    far.action(none.params);
    expect(none.emit).not.toHaveBeenCalled();

    const { params, emit } = makeEnemyParams({
      structures: [
        makeStructure(1, "SAM Launcher", 104),
        makeStructure(2, "City", 101),
        makeStructure(3, "Warship", 100),
      ],
    });
    const sabotage = findSpy(rootMenuElement.subMenu!(params)).subMenu(
      params,
    )[2];
    expect(sabotage.disabled(params)).toBe(false);
    sabotage.action(params);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({
      targetID: "p2",
      mission: "sabotage",
      unitId: 2,
    });
  });
});
