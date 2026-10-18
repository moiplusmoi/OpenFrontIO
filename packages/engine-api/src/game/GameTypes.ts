import { AllPlayersStats, ClientID } from "../Schemas";

import { TileRef } from "./GameMap";
import { GameUpdate, GameUpdateType } from "./GameUpdates";

function isEnumValue<T extends Record<string, string | number>>(
  enumObj: T,
  value: unknown,
): value is T[keyof T] {
  return Object.values(enumObj).includes(value as T[keyof T]);
}

export type PlayerID = string;

export type Tick = number;

export type Gold = bigint;

export type WarshipState = {
  state: "patrolling" | "retreating" | "docked";
  patrolTile?: TileRef;
  retreatPort?: TileRef;
  isInCombat?: boolean;
  lastCombatTick: number;
  // Veterancy level (0–max) plus a shared integer progress meter fed by
  // transport kills and trade captures (see UnitImpl.addVeterancyProgress).
  veterancy: number;
  veterancyProgress: number;
};

export type TransportShipState = {
  isRetreating: boolean;
  troops: number;
};

export type NukeState = {
  trajectory: TrajectoryTile[];
  trajectoryIndex: number;
  targetedBySam: boolean;
  waitTicks: number;
};

export type SamLauncherState = {
  upgradeStartTick?: number;
  startRange: number;
  targetLevel: number;
  duration: number;
};

export const AllPlayers = "AllPlayers" as const;

// export type GameUpdates = Record<GameUpdateType, GameUpdate[]>;
// Create a type that maps GameUpdateType to its corresponding update type
type UpdateTypeMap<T extends GameUpdateType> = Extract<GameUpdate, { type: T }>;

// Then use it to create the record type
export type GameUpdates = {
  [K in GameUpdateType]: UpdateTypeMap<K>[];
};

export interface MapPos {
  x: number;
  y: number;
}

export enum Difficulty {
  Easy = "Easy",
  Medium = "Medium",
  Hard = "Hard",
  Impossible = "Impossible",
}

export const isDifficulty = (value: unknown): value is Difficulty =>
  isEnumValue(Difficulty, value);

export type Team = string;

export interface SpawnArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TeamGameSpawnAreas = Record<string, SpawnArea[]>;

export const Duos = "Duos" as const;

export const Trios = "Trios" as const;

export const Quads = "Quads" as const;

export const HumansVsNations = "Humans Vs Nations" as const;

export const ColoredTeams: Record<string, Team> = {
  Red: "Red",
  Blue: "Blue",
  Teal: "Teal",
  Purple: "Purple",
  Yellow: "Yellow",
  Orange: "Orange",
  Green: "Green",
  Bot: "Bot",
  Humans: "Humans",
  Nations: "Nations",
} as const;

// GameMapType and the maps list are generated from
// map-generator/assets/maps/<map>/info.json by the map-generator
// (`npm run gen-maps`).
export {
  GameMapType,
  mapCategoryOrder,
  maps,
  type CustomTribe,
  type GameMapName,
  type MapCategory,
  type MapInfo,
  type SpecialModifierKey,
} from "./Maps.gen";

export enum GameType {
  Singleplayer = "Singleplayer",
  Public = "Public",
  Private = "Private",
}

export const isGameType = (value: unknown): value is GameType =>
  isEnumValue(GameType, value);

export enum GameMode {
  FFA = "Free For All",
  Team = "Team",
}

export enum RankedType {
  OneVOne = "1v1",
  TwoVTwo = "2v2",
  FreeForAll = "ffa",
  ClanWars = "clanwars",
}

// Ranked FFA lobby size. The API's matcher assigns between these many players
// and only rates a game whose roster is in this range, so a match that ends
// up with fewer is cancelled before it starts.
export const RANKED_FFA_MIN_PLAYERS = 4;
export const RANKED_FFA_MAX_PLAYERS = 10;

export const isGameMode = (value: unknown): value is GameMode =>
  isEnumValue(GameMode, value);

export enum GameMapSize {
  Compact = "Compact",
  Normal = "Normal",
}

export interface PublicGameModifiers {
  isCompact?: boolean;
  isRandomSpawn?: boolean;
  isCrowded?: boolean;
  isHardNations?: boolean;
  startingGold?: number;
  goldMultiplier?: number;
  isAlliancesDisabled?: boolean;
  isPortsDisabled?: boolean;
  isNukesDisabled?: boolean;
  isSAMsDisabled?: boolean;
  isPeaceTime?: boolean;
  isWaterNukes?: boolean;
  isDoomsdayClock?: boolean;
}

// Largest bulk-purchase amount an intent may carry (mirrored by the intent
// schemas' max). Also the length of BuildableUnit.upgradeCosts.
export const MAX_UPGRADE_AMOUNT = 50;

export interface UnitInfo {
  maxHealth?: number;
  damage?: number;
  constructionDuration?: number;
  upgradable?: boolean;
}

function unitTypeGroup<T extends readonly UnitType[]>(types: T) {
  return {
    types,
    has(type: UnitType): type is T[number] {
      return (types as readonly UnitType[]).includes(type);
    },
  };
}

export enum UnitType {
  TransportShip = "Transport",
  Warship = "Warship",
  Shell = "Shell",
  SAMMissile = "SAMMissile",
  Port = "Port",
  AtomBomb = "Atom Bomb",
  HydrogenBomb = "Hydrogen Bomb",
  TradeShip = "Trade Ship",
  MissileSilo = "Missile Silo",
  DefensePost = "Defense Post",
  SAMLauncher = "SAM Launcher",
  City = "City",
  MIRV = "MIRV",
  MIRVWarhead = "MIRV Warhead",
  Train = "Train",
  Factory = "Factory",
  Spy = "Spy",
  // GalloFront aviation
  Airport = "Airport",
  Bomber = "Bomber",
  Fighter = "Fighter",
  AirTransport = "Air Transport",
}

export const Aircraft = [
  UnitType.Bomber,
  UnitType.Fighter,
  UnitType.AirTransport,
] as const;

// GalloFront espionage
export enum SpyMission {
  Reveal = "reveal",
  Sabotage = "sabotage",
  Steal = "steal",
}
/** Intel a player holds on another (smallID) until a tick; stale = 30 s old data. */
export interface IntelEntry {
  target: number;
  until: Tick;
  stale: boolean;
}

// ---- GalloFront: technologies ----
// Three branches × four levels. A level requires the previous one of the
// same branch. Costs/durations live in Config (engine-lib) so client and
// engine read the same numbers; effects are applied inside the rules they
// modify (gold rate, troop cap, attack logic, SAM range, unit gating).
export enum TechBranch {
  Economy = "eco",
  Military = "mil",
  Defense = "def",
}

export enum TechId {
  Eco1 = "eco_1",
  Eco2 = "eco_2",
  Eco3 = "eco_3",
  Eco4 = "eco_4",
  Mil1 = "mil_1",
  Mil2 = "mil_2",
  Mil3 = "mil_3",
  Mil4 = "mil_4",
  Def1 = "def_1",
  Def2 = "def_2",
  Def3 = "def_3",
  Def4 = "def_4",
}

export interface TechDef {
  id: TechId;
  branch: TechBranch;
  level: 1 | 2 | 3 | 4;
  requires: TechId | null;
}

export const TECH_TREE: readonly TechDef[] = [
  { id: TechId.Eco1, branch: TechBranch.Economy, level: 1, requires: null },
  {
    id: TechId.Eco2,
    branch: TechBranch.Economy,
    level: 2,
    requires: TechId.Eco1,
  },
  {
    id: TechId.Eco3,
    branch: TechBranch.Economy,
    level: 3,
    requires: TechId.Eco2,
  },
  {
    id: TechId.Eco4,
    branch: TechBranch.Economy,
    level: 4,
    requires: TechId.Eco3,
  },
  { id: TechId.Mil1, branch: TechBranch.Military, level: 1, requires: null },
  {
    id: TechId.Mil2,
    branch: TechBranch.Military,
    level: 2,
    requires: TechId.Mil1,
  },
  {
    id: TechId.Mil3,
    branch: TechBranch.Military,
    level: 3,
    requires: TechId.Mil2,
  },
  {
    id: TechId.Mil4,
    branch: TechBranch.Military,
    level: 4,
    requires: TechId.Mil3,
  },
  { id: TechId.Def1, branch: TechBranch.Defense, level: 1, requires: null },
  {
    id: TechId.Def2,
    branch: TechBranch.Defense,
    level: 2,
    requires: TechId.Def1,
  },
  {
    id: TechId.Def3,
    branch: TechBranch.Defense,
    level: 3,
    requires: TechId.Def2,
  },
  {
    id: TechId.Def4,
    branch: TechBranch.Defense,
    level: 4,
    requires: TechId.Def3,
  },
];

export function techDef(id: TechId): TechDef {
  const def = TECH_TREE.find((t) => t.id === id);
  if (def === undefined) throw new Error(`unknown tech ${id}`);
  return def;
}

/** Highest level acquired in a branch, from a list of acquired tech ids. */
export function techLevelOf(
  techs: readonly TechId[],
  branch: TechBranch,
): number {
  let level = 0;
  for (const id of techs) {
    const def = techDef(id);
    if (def.branch === branch && def.level > level) level = def.level;
  }
  return level;
}

/** A research in progress: started at startTick, completes at endTick. */
export interface ResearchState {
  tech: TechId;
  startTick: Tick;
  endTick: Tick;
}

export enum TrainType {
  Engine = "Engine",
  TailEngine = "TailEngine",
  Carriage = "Carriage",
}

export const Nukes = unitTypeGroup([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRVWarhead,
  UnitType.MIRV,
] as const);

export const BuildableAttacks = unitTypeGroup([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
  UnitType.Warship,
  UnitType.Bomber,
  UnitType.Fighter,
] as const);

export const Structures = unitTypeGroup([
  UnitType.City,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
  UnitType.Port,
  UnitType.Factory,
  UnitType.Airport,
] as const);

export const BuildMenus = unitTypeGroup([
  ...Structures.types,
  ...BuildableAttacks.types,
] as const);

export const PlayerBuildable = unitTypeGroup([
  ...BuildMenus.types,
  UnitType.TransportShip,
  UnitType.Spy,
  UnitType.AirTransport,
] as const);

export type PlayerBuildableUnitType = (typeof PlayerBuildable.types)[number];

export type TrajectoryTile = {
  tile: TileRef;
  targetable: boolean;
};

export enum Relation {
  Hostile = 0,
  Distrustful = 1,
  Neutral = 2,
  Friendly = 3,
}

export class Nation {
  constructor(
    public readonly spawnCell: Cell | undefined,
    public readonly playerInfo: PlayerInfo,
  ) {}
}

export class Cell {
  public index: number;

  private strRepr: string;

  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {
    this.strRepr = `Cell[${this.x},${this.y}]`;
  }

  pos(): MapPos {
    return {
      x: this.x,
      y: this.y,
    };
  }

  toString(): string {
    return this.strRepr;
  }
}

export enum TerrainType {
  Plains,
  Highland,
  Mountain,
  Ocean,
  Impassable,
}

export enum PlayerType {
  Bot = "BOT",
  Human = "HUMAN",
  Nation = "NATION",
}

export class PlayerInfo {
  public readonly displayName: string;

  constructor(
    public readonly name: string,
    public readonly playerType: PlayerType,
    // null if tribe.
    public readonly clientID: ClientID | null,
    // TODO: make player id the small id
    public readonly id: PlayerID,
    public readonly isLobbyCreator: boolean = false,
    public readonly clanTag: string | null = null,
    public readonly friends: ClientID[] = [],
    // Server-pinned team slot (index into the game's team list) for
    // matchmade team games; null = assign normally.
    public readonly teamIndex: number | null = null,
    // Manifest flag code (e.g. "in", "pk") for PlayerType.Nation players.
    // Carried from the map manifest through to the client so it can render
    // the correct flag even when multiple nations on a map share a display
    // name (e.g. India's and Pakistan's "Punjab").
    public readonly nationFlag: string | null = null,
  ) {
    this.displayName = formatPlayerDisplayName(this.name, this.clanTag);
  }
}

export interface TerraNullius {
  isPlayer(): false;
  id(): null;
  clientID(): ClientID;
  smallID(): number;
}

export interface PlayerActions {
  canAttack: boolean;
  buildableUnits: BuildableUnit[];
  canSendEmojiAllPlayers: boolean;
  canEmbargoAll?: boolean;
  interaction?: PlayerInteraction;
}

export interface BuildableUnit {
  canBuild: TileRef | false;
  // unit id of the existing unit that can be upgraded, or false if it cannot be upgraded.
  canUpgrade: number | false;
  type: PlayerBuildableUnitType;
  cost: Gold;
  // Cumulative cost of upgrading 1..MAX_UPGRADE_AMOUNT times (upgrade costs
  // escalate per level, so a bulk total is NOT cost * amount). Only set when
  // canUpgrade is not false.
  upgradeCosts?: Gold[];
  overlappingRailroads: TileRef[];
  ghostRailPaths: TileRef[][];
}

// Total price of buying `amount` of a buildable in one intent. Upgrades use
// the escalating totals from core; flat-cost units (nukes) scale linearly.
export function bulkCost(bu: BuildableUnit, amount: number): Gold {
  return bu.upgradeCosts?.[amount - 1] ?? bu.cost * BigInt(amount);
}

// Largest amount (up to MAX_UPGRADE_AMOUNT) whose bulk total fits in `gold`.
// 0 when not even a single purchase is affordable.
export function maxBulkAmount(bu: BuildableUnit, gold: Gold): number {
  let max = 0;
  for (let n = 1; n <= MAX_UPGRADE_AMOUNT; n++) {
    // Never price upgrades past the shipped totals — beyond the array,
    // bulkCost would silently fall back to linear pricing.
    if (bu.upgradeCosts !== undefined && n > bu.upgradeCosts.length) {
      break;
    }
    if (bulkCost(bu, n) > gold) {
      break;
    }
    max = n;
  }
  return max;
}

// Fixed mid-ladder steps for the bulk menus. Bombs come in smaller batches
// than structure upgrades — x2 is the standard play against a single SAM.
export const NUKE_BULK_STEPS: readonly number[] = [2, 5];

export const STRUCTURE_BULK_STEPS: readonly number[] = [5, 10];

export interface PlayerProfile {
  relations: Record<number, Relation>;
  alliances: number[];
}

export interface PlayerBorderTiles {
  borderTiles: ReadonlySet<TileRef>;
}

/**
 * The humans' stats as they stand right now, for the client's provisional XP
 * figure (src/client/ProvisionalXp.ts): the player's own XP is scored from
 * the same per-player stats the end-of-game record carries, and in FFA from
 * who went out before them. Built by the engine's humanStatsSnapshot().
 */
export interface HumanStatsSnapshot {
  // The tick the snapshot was taken at.
  tick: number;
  // Every human's stats, keyed by clientID: the object the archived record
  // carries per player (players who never spawned have none).
  stats: AllPlayersStats;
  // Humans whose connection is currently marked lost: clientID -> the tick
  // it was. The API reads a player who never came back as having left then.
  disconnectedAt: Record<ClientID, number>;
}

export interface AllianceInfo {
  expiresAt: Tick;
  inExtensionWindow: boolean;
  myPlayerAgreedToExtend: boolean;
  otherAgreedToExtend: boolean;
  canExtend: boolean;
}

export interface PlayerInteraction {
  sharedBorder: boolean;
  canSendEmoji: boolean;
  canSendAllianceRequest: boolean;
  canBreakAlliance: boolean;
  canTarget: boolean;
  canDonateGold: boolean;
  canDonateTroops: boolean;
  canEmbargo: boolean;
  allianceInfo?: AllianceInfo;
}

export interface EmojiMessage {
  message: string;
  senderID: number;
  recipientID: number | typeof AllPlayers;
  createdAt: Tick;
}

export enum MessageType {
  ATTACK_FAILED,
  ATTACK_CANCELLED,
  ATTACK_REQUEST,
  CONQUERED_PLAYER,
  MIRV_INBOUND,
  NUKE_INBOUND,
  NUKE_DETONATED,
  HYDROGEN_BOMB_INBOUND,
  NAVAL_INVASION_INBOUND,
  SAM_MISS,
  SAM_HIT,
  CAPTURED_ENEMY_UNIT,
  UNIT_DESTROYED,
  ALLIANCE_ACCEPTED,
  ALLIANCE_REJECTED,
  ALLIANCE_REQUEST,
  ALLIANCE_BROKEN,
  ALLIANCE_EXPIRED,
  DONATION_SENT,
  DONATION_RECEIVED,
  CHAT,
  RENEW_ALLIANCE,
  // GalloFront: a technology finished researching.
  RESEARCH_COMPLETE,
  CAPITAL_FALLEN,
  SPY_SUCCESS,
  SPY_CAPTURED,
  SPY_FOILED,
  SABOTAGED,
  GOLD_STOLEN,
  BOMBER_INBOUND,
  AIR_RAID,
  PARADROP_INBOUND,
  FIGHTER_INTERCEPT,
  AIRCRAFT_SHOT_DOWN,
}

// Message categories used for filtering events in the EventsDisplay
export enum MessageCategory {
  ATTACK = "ATTACK",
  NUKE = "NUKE",
  ALLIANCE = "ALLIANCE",
  TRADE = "TRADE",
  CHAT = "CHAT",
}

// Ensures that all message types are included in a category
export const MESSAGE_TYPE_CATEGORIES: Record<MessageType, MessageCategory> = {
  [MessageType.ATTACK_FAILED]: MessageCategory.ATTACK,
  [MessageType.ATTACK_CANCELLED]: MessageCategory.ATTACK,
  [MessageType.ATTACK_REQUEST]: MessageCategory.ATTACK,
  [MessageType.CONQUERED_PLAYER]: MessageCategory.ATTACK,
  [MessageType.MIRV_INBOUND]: MessageCategory.NUKE,
  [MessageType.NUKE_INBOUND]: MessageCategory.NUKE,
  [MessageType.NUKE_DETONATED]: MessageCategory.NUKE,
  [MessageType.HYDROGEN_BOMB_INBOUND]: MessageCategory.NUKE,
  [MessageType.NAVAL_INVASION_INBOUND]: MessageCategory.ATTACK,
  [MessageType.SAM_MISS]: MessageCategory.ATTACK,
  [MessageType.SAM_HIT]: MessageCategory.ATTACK,
  [MessageType.CAPTURED_ENEMY_UNIT]: MessageCategory.ATTACK,
  [MessageType.UNIT_DESTROYED]: MessageCategory.ATTACK,
  [MessageType.ALLIANCE_ACCEPTED]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_REJECTED]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_REQUEST]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_BROKEN]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_EXPIRED]: MessageCategory.ALLIANCE,
  [MessageType.RENEW_ALLIANCE]: MessageCategory.ALLIANCE,
  [MessageType.DONATION_SENT]: MessageCategory.TRADE,
  [MessageType.DONATION_RECEIVED]: MessageCategory.TRADE,
  [MessageType.CHAT]: MessageCategory.CHAT,
  [MessageType.RESEARCH_COMPLETE]: MessageCategory.TRADE,
  [MessageType.CAPITAL_FALLEN]: MessageCategory.ATTACK,
  [MessageType.SPY_SUCCESS]: MessageCategory.ATTACK,
  [MessageType.SPY_CAPTURED]: MessageCategory.ATTACK,
  [MessageType.SPY_FOILED]: MessageCategory.ATTACK,
  [MessageType.SABOTAGED]: MessageCategory.ATTACK,
  [MessageType.GOLD_STOLEN]: MessageCategory.ATTACK,
  [MessageType.BOMBER_INBOUND]: MessageCategory.ATTACK,
  [MessageType.AIR_RAID]: MessageCategory.ATTACK,
  [MessageType.PARADROP_INBOUND]: MessageCategory.ATTACK,
  [MessageType.FIGHTER_INTERCEPT]: MessageCategory.ATTACK,
  [MessageType.AIRCRAFT_SHOT_DOWN]: MessageCategory.ATTACK,
} as const;

/**
 * Get the category of a message type
 */
export function getMessageCategory(messageType: MessageType): MessageCategory {
  return MESSAGE_TYPE_CATEGORIES[messageType];
}

export interface NameViewData {
  x: number;
  y: number;
  size: number;
}

export function formatPlayerDisplayName(
  username: string,
  clanTag?: string | null,
): string {
  return clanTag ? `[${clanTag}] ${username}` : username;
}
