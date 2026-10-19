import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  AllPlayers,
  BuildableAttacks,
  bulkCost,
  maxBulkAmount,
  NUKE_BULK_STEPS,
  PlayerActions,
  PlayerBuildableUnitType,
  SpyMission,
  STRUCTURE_BULK_STEPS,
  Structures,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { Emoji, flattenedEmojiTable } from "@openfront/engine-api/Schemas";
import { Config } from "@openfront/engine-lib/configuration/Config";
import { renderNumber } from "@openfront/engine-lib/Format";
import { findClosestBy } from "@openfront/engine-lib/Util";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { UIState } from "../../UIState";
import { translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";
import { BuildItemDisplay, BuildMenu, flattenedBuildTable } from "./BuildMenu";
import { ChatIntegration } from "./ChatIntegration";
import { EmojiTable } from "./EmojiTable";
import { PlayerActionHandler } from "./PlayerActionHandler";
import { PlayerPanel } from "./PlayerPanel";
import { TooltipItem } from "./RadialMenu";
import { missingTech, requiresTechLabel } from "./TechLock";
import { ShowTechPanelEvent } from "./TechPanelEvents";

import { EventBus } from "@openfront/shared/EventBus";
import {
  BuildUnitIntentEvent,
  SendParadropIntentEvent,
  SendSetCapitalIntentEvent,
  SendSpyIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../Transport";
const allianceIcon = assetUrl("images/AllianceIconWhite.svg");
const boatIcon = assetUrl("images/BoatIconWhite.svg");
const buildIcon = assetUrl("images/BuildIconWhite.svg");
const chatIcon = assetUrl("images/ChatIconWhite.svg");
const donateGoldIcon = assetUrl("images/DonateGoldIconWhite.svg");
const donateTroopIcon = assetUrl("images/DonateTroopIconWhite.svg");
const emojiIcon = assetUrl("images/EmojiIconWhite.svg");
const infoIcon = assetUrl("images/InfoIcon.svg");
const swordIcon = assetUrl("images/SwordIconWhite.svg");
const targetIcon = assetUrl("images/TargetIconWhite.svg");
const traitorIcon = assetUrl("images/TraitorIconWhite.svg");
const xIcon = assetUrl("images/XIcon.svg");

export interface MenuElementParams {
  myPlayer: PlayerView;
  selected: PlayerView | null;
  tile: TileRef;
  playerActions: PlayerActions;
  game: GameView;
  buildMenu: BuildMenu;
  emojiTable: EmojiTable;
  playerActionHandler: PlayerActionHandler;
  playerPanel: PlayerPanel;
  chatIntegration: ChatIntegration;
  eventBus: EventBus;
  uiState?: UIState;
  closeMenu: () => void;
}

export interface MenuElement {
  id: string;
  name: string;
  displayed?: boolean | ((params: MenuElementParams) => boolean);
  color?: string | ((params: MenuElementParams) => string);
  icon?: string;
  text?: string;
  fontSize?: string;
  tooltipItems?: TooltipItem[];
  tooltipKeys?: TooltipKey[];

  cooldown?: (params: MenuElementParams) => number;
  disabled: (params: MenuElementParams) => boolean;
  action?: (params: MenuElementParams) => void; // For leaf items that perform actions
  subMenu?: (params: MenuElementParams) => MenuElement[]; // For non-leaf items that open submenus

  renderType?: string;

  timerFraction?: (params: MenuElementParams) => number; // 0..1, for arc timer overlay
}

export interface TooltipKey {
  key: string;
  className: string;
  params?: Record<string, string | number>;
}

export interface CenterButtonElement {
  disabled: (params: MenuElementParams) => boolean;
  action: (params: MenuElementParams) => void;
}

export const COLORS = {
  build: "#e6c74a",
  building: "#1e3a5f",
  boat: "#2a82c9",
  disabled: "#94a3b8",
  ally: "#4ade80",
  breakAlly: "#dc2626",
  breakAllyNoDebuff: "#d97706",
  delete: "#ef4444",
  info: "#475569",
  target: "#ef4444",
  attack: "#ef4444",
  infoDetails: "#7f8c8d",
  infoEmoji: "#fbbf24",
  trade: "#0891b2",
  embargo: "#7c3aed",
  spy: "#334155",
  tooltip: {
    cost: "#f59e0b",
    count: "#94a3b8",
  },
  chat: {
    default: "#6366f1",
    help: "#22c55e",
    attack: "#ef4444",
    defend: "#3b82f6",
    greet: "#f97316",
    misc: "#a855f7",
    warnings: "#fbbf24",
  },
};

export enum Slot {
  Info = "info",
  Boat = "boat",
  Build = "build",
  Attack = "attack",
  Ally = "ally",
  Back = "back",
  Delete = "delete",
}

function isFriendlyTarget(params: MenuElementParams): boolean {
  const selectedPlayer = params.selected;
  if (selectedPlayer === null) return false;
  const isFriendly = (selectedPlayer as PlayerView).isFriendly;
  if (typeof isFriendly !== "function") return false;
  return isFriendly.call(selectedPlayer, params.myPlayer);
}

function isDisconnectedTarget(params: MenuElementParams): boolean {
  const selectedPlayer = params.selected;
  if (selectedPlayer === null) return false;
  const isDisconnected = (selectedPlayer as PlayerView).isDisconnected;
  if (typeof isDisconnected !== "function") return false;
  return isDisconnected.call(selectedPlayer);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const infoChatElement: MenuElement = {
  id: "info_chat",
  name: "chat",
  disabled: () => false,
  color: COLORS.chat.default,
  icon: chatIcon,
  subMenu: (params: MenuElementParams) =>
    params.chatIntegration
      .createQuickChatMenu(params.selected!)
      .map((item) => ({
        ...item,
        action: item.action
          ? (_params: MenuElementParams) => item.action!(params)
          : undefined,
      })),
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyTargetElement: MenuElement = {
  id: "ally_target",
  name: "target",
  disabled: (params: MenuElementParams): boolean => {
    if (params.selected === null) return true;
    return !params.playerActions.interaction?.canTarget;
  },
  color: COLORS.target,
  icon: targetIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleTargetPlayer(params.selected!.id());
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyTradeElement: MenuElement = {
  id: "ally_trade",
  name: "trade",
  disabled: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canEmbargo,
  displayed: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canEmbargo,
  color: COLORS.trade,
  text: translateText("player_panel.start_trade"),
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleEmbargo(params.selected!, "stop");
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyEmbargoElement: MenuElement = {
  id: "ally_embargo",
  name: "embargo",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canEmbargo,
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canEmbargo,
  color: COLORS.embargo,
  text: translateText("player_panel.stop_trade"),
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleEmbargo(params.selected!, "start");
    params.closeMenu();
  },
};

const allyRequestElement: MenuElement = {
  id: "ally_request",
  name: "request",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canSendAllianceRequest,
  displayed: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canBreakAlliance,
  color: COLORS.ally,
  icon: allianceIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleAllianceRequest(
      params.myPlayer,
      params.selected!,
    );
    params.closeMenu();
  },
};

const allyExtendElement: MenuElement = {
  id: "ally_extend",
  name: "extend",
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.allianceInfo?.inExtensionWindow,
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.allianceInfo?.canExtend,
  color: COLORS.ally,
  icon: allianceIcon,
  action: (params: MenuElementParams) => {
    if (!params.playerActions?.interaction?.allianceInfo?.canExtend) return;
    params.playerActionHandler.handleExtendAlliance(params.selected!);
    params.closeMenu();
  },
  timerFraction: (params: MenuElementParams): number => {
    const interaction = params.playerActions?.interaction;
    if (!interaction?.allianceInfo) return 1;
    const remaining = Math.max(
      0,
      interaction.allianceInfo.expiresAt - params.game.ticks(),
    );
    const extensionWindow = Math.max(
      1,
      params.game.config().allianceExtensionPromptOffset(),
    );
    return Math.max(0, Math.min(1, remaining / extensionWindow));
  },
  renderType: "allyExtend",
};

const allyBreakElement: MenuElement = {
  id: "ally_break",
  name: "break",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canBreakAlliance,
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canBreakAlliance,
  color: (params: MenuElementParams) =>
    params.selected?.isTraitor() || params.selected?.isDisconnected()
      ? COLORS.breakAllyNoDebuff
      : COLORS.breakAlly,
  icon: traitorIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleBreakAlliance(
      params.myPlayer,
      params.selected!,
    );
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyDonateGoldElement: MenuElement = {
  id: "ally_donate_gold",
  name: "donate gold",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canDonateGold,
  color: COLORS.ally,
  icon: donateGoldIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleDonateGold(params.selected!);
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyDonateTroopsElement: MenuElement = {
  id: "ally_donate_troops",
  name: "donate troops",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canDonateTroops,
  color: COLORS.ally,
  icon: donateTroopIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleDonateTroops(params.selected!);
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const infoPlayerElement: MenuElement = {
  id: "info_player",
  name: "player",
  disabled: () => false,
  color: COLORS.info,
  icon: infoIcon,
  action: (params: MenuElementParams) => {
    params.playerPanel.show(params.playerActions, params.tile);
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const infoEmojiElement: MenuElement = {
  id: "info_emoji",
  name: "emoji",
  disabled: () => false,
  color: COLORS.infoEmoji,
  icon: emojiIcon,
  subMenu: (params: MenuElementParams) => {
    const emojiElements: MenuElement[] = [
      {
        id: "emoji_more",
        name: "more",
        disabled: () => false,
        color: COLORS.infoEmoji,
        icon: emojiIcon,
        action: (params: MenuElementParams) => {
          params.emojiTable.showTable((emoji) => {
            const targetPlayer =
              params.selected === params.game.myPlayer()
                ? AllPlayers
                : params.selected;
            params.playerActionHandler.handleEmoji(
              targetPlayer!,
              flattenedEmojiTable.indexOf(emoji as Emoji),
            );
            params.emojiTable.hideTable();
          });
        },
      },
    ];

    const emojiCount = 8;
    for (let i = 0; i < emojiCount; i++) {
      emojiElements.push({
        id: `emoji_${i}`,
        name: flattenedEmojiTable[i],
        text: flattenedEmojiTable[i],
        disabled: () => false,
        fontSize: "25px",
        action: (params: MenuElementParams) => {
          const targetPlayer =
            params.selected === params.game.myPlayer()
              ? AllPlayers
              : params.selected;
          params.playerActionHandler.handleEmoji(targetPlayer!, i);
          params.closeMenu();
        },
      });
    }

    return emojiElements;
  },
};

export const infoMenuElement: MenuElement = {
  id: Slot.Info,
  name: "info",
  disabled: (params: MenuElementParams) =>
    !params.selected || params.game.inSpawnPhase(),
  icon: infoIcon,
  color: COLORS.info,
  action: (params: MenuElementParams) => {
    params.playerPanel.show(params.playerActions, params.tile);
  },
};

function getAllEnabledUnits(
  myPlayer: boolean,
  config: Config,
): Set<PlayerBuildableUnitType> {
  const units: Set<PlayerBuildableUnitType> =
    new Set<PlayerBuildableUnitType>();

  const addIfEnabled = (unitType: PlayerBuildableUnitType) => {
    if (!config.isUnitDisabled(unitType)) {
      units.add(unitType);
    }
  };

  if (myPlayer) {
    Structures.types.forEach(addIfEnabled);
    // GalloFront aviation: a fighter is stationed at one of MY airports, so
    // it is built from my own territory, not aimed at an enemy.
    addIfEnabled(UnitType.Fighter);
  } else {
    BuildableAttacks.types.forEach(addIfEnabled);
  }

  return units;
}

/** Whether `type` belongs to the attack submenu (aimed at a tile). */
function isAttackMenuUnit(type: PlayerBuildableUnitType): boolean {
  return BuildableAttacks.has(type) && type !== UnitType.Fighter;
}

/** The tech the local player still needs for `unit`, or null (see TechLock). */
function lockedBehind(
  params: MenuElementParams,
  unit: UnitType,
): TechId | null {
  return missingTech(params.game.config?.(), params.myPlayer, unit);
}

/** Tooltip lines for a locked item: "🔒 Requires: X" and the tap hint. */
function lockedTooltip(tech: TechId): TooltipItem[] {
  return [
    { text: requiresTechLabel(tech), className: "cost" },
    {
      text: translateText("build_menu.requires_tech_tap"),
      className: "description",
    },
  ];
}

/**
 * GalloFront: a locked item stays tappable — it is the shortcut to the
 * technologies panel, opened on the tech it needs — rather than a muted
 * price nobody can pay yet. Only the spawn phase disables it (RadialMenu's
 * isItemDisabled handles that itself).
 */
function openTechPanel(params: MenuElementParams, tech: TechId) {
  params.eventBus.emit(new ShowTechPanelEvent(true, tech));
  params.closeMenu();
}

function createMenuElements(
  params: MenuElementParams,
  filterType: "attack" | "build",
  elementIdPrefix: string,
): MenuElement[] {
  const unitTypes: Set<PlayerBuildableUnitType> = getAllEnabledUnits(
    params.selected === params.myPlayer,
    params.game.config(),
  );

  return flattenedBuildTable
    .filter(
      (item) =>
        unitTypes.has(item.unitType) &&
        (filterType === "attack"
          ? isAttackMenuUnit(item.unitType)
          : !isAttackMenuUnit(item.unitType)),
    )
    .map((item: BuildItemDisplay) => {
      const locked = lockedBehind(params, item.unitType);
      if (locked !== null) {
        return {
          id: `${elementIdPrefix}_${item.unitType}`,
          name: item.key
            ? item.key.replace("unit_type.", "")
            : item.unitType.toString(),
          disabled: () => false,
          color: COLORS.disabled,
          icon: item.icon,
          tooltipItems: [
            { text: translateText(item.key ?? ""), className: "title" },
            ...lockedTooltip(locked),
          ],
          action: (p: MenuElementParams) => openTechPanel(p, locked),
        };
      }
      if (item.unitType === UnitType.Fighter) {
        return fighterBuildElement(item, params, `${elementIdPrefix}_`);
      }
      return {
        id: `${elementIdPrefix}_${item.unitType}`,
        name: item.key
          ? item.key.replace("unit_type.", "")
          : item.unitType.toString(),
        disabled: (p: MenuElementParams) =>
          !p.buildMenu.canBuildOrUpgrade(item),
        color: (p: MenuElementParams) =>
          p.buildMenu.canBuildOrUpgrade(item)
            ? filterType === "attack"
              ? COLORS.attack
              : COLORS.building
            : COLORS.building,
        icon: item.icon,
        tooltipItems: [
          { text: translateText(item.key ?? ""), className: "title" },
          {
            text: translateText(item.description ?? ""),
            className: "description",
          },
          {
            text: `${renderNumber(params.buildMenu.cost(item))} ${translateText("player_panel.gold")}`,
            className: "cost",
          },
          item.countable
            ? { text: `${params.buildMenu.count(item)}x`, className: "count" }
            : null,
        ].filter(
          (tooltipItem): tooltipItem is TooltipItem => tooltipItem !== null,
        ),
        subMenu: (params: MenuElementParams) => {
          const buildableUnit = params.playerActions.buildableUnits.find(
            (bu) => bu.type === item.unitType,
          );
          if (!buildableUnit) {
            return [];
          }
          const isStackableNuke =
            item.unitType === UnitType.AtomBomb &&
            buildableUnit.canBuild !== false;
          if (
            (buildableUnit.canUpgrade === false && !isStackableNuke) ||
            !params.buildMenu.canBuildOrUpgrade(item)
          ) {
            return [];
          }
          // Always four slots in fixed positions for muscle memory — laid
          // out clockwise from the top: x1, the two fixed steps, then the
          // largest amount the player can execute right now (bombs: top x1,
          // right x2, bottom x5, left xMax). max is capped by gold, and for
          // nukes by loaded silo tubes; slots beyond it render disabled.
          // With no executable amount past x1 there is nothing to choose —
          // return no submenu so the click falls through to an immediate x1
          // (see action below).
          const myPlayer = params.game.myPlayer();
          let maxAmount = maxBulkAmount(buildableUnit, myPlayer?.gold() ?? 0n);
          if (isStackableNuke) {
            maxAmount = Math.min(maxAmount, myPlayer?.readyMissileCount() ?? 0);
          }
          if (maxAmount <= 1) {
            return [];
          }
          const steps = isStackableNuke
            ? NUKE_BULK_STEPS
            : STRUCTURE_BULK_STEPS;
          const slots = [1, ...steps, maxAmount];
          return slots.map((amount, i) => {
            const isMaxSlot = i === slots.length - 1;
            const executable = amount <= maxAmount;
            const cost = bulkCost(buildableUnit, amount);
            return {
              id: isMaxSlot
                ? `upgrade_${item.unitType}_max`
                : `upgrade_${item.unitType}_${amount}`,
              name: translateText("build_menu.upgrade_amount", {
                amount: amount.toString(),
              }),
              text: translateText("build_menu.upgrade_amount", {
                amount: amount.toString(),
              }),
              fontSize: "20px",
              color: (p: MenuElementParams) =>
                executable && (p.game.myPlayer()?.gold() ?? 0n) >= cost
                  ? COLORS.building
                  : COLORS.disabled,
              icon: "",
              tooltipItems: [
                {
                  text: translateText("radial_menu.upgrade_x", {
                    amount: amount.toString(),
                  }),
                  className: "title",
                },
                {
                  text: `${renderNumber(cost)} ${translateText("player_panel.gold")}`,
                  className: "cost",
                },
              ],
              disabled: (p: MenuElementParams) =>
                !executable || (p.game.myPlayer()?.gold() ?? 0n) < cost,
              action: (p: MenuElementParams) => {
                if (isStackableNuke) {
                  p.eventBus.emit(
                    new BuildUnitIntentEvent(
                      buildableUnit.type,
                      p.tile,
                      p.uiState?.rocketDirectionUp,
                      amount,
                    ),
                  );
                } else {
                  p.eventBus.emit(
                    new SendUpgradeStructureIntentEvent(
                      buildableUnit.canUpgrade as number,
                      buildableUnit.type,
                      amount,
                    ),
                  );
                }
                p.closeMenu();
              },
            };
          });
        },
        action: (params: MenuElementParams) => {
          const buildableUnit = params.playerActions.buildableUnits.find(
            (bu) => bu.type === item.unitType,
          );
          if (buildableUnit === undefined) {
            return;
          }
          if (params.buildMenu.canBuildOrUpgrade(item)) {
            if (buildableUnit.canUpgrade !== false) {
              params.eventBus.emit(
                new SendUpgradeStructureIntentEvent(
                  buildableUnit.canUpgrade,
                  buildableUnit.type,
                ),
              );
            } else if (buildableUnit.canBuild !== false) {
              const rocketDirectionUp =
                item.unitType === UnitType.AtomBomb ||
                item.unitType === UnitType.HydrogenBomb
                  ? params.uiState?.rocketDirectionUp
                  : undefined;
              params.eventBus.emit(
                new BuildUnitIntentEvent(
                  buildableUnit.type,
                  params.tile,
                  rocketDirectionUp,
                ),
              );
            }
          }
          params.closeMenu();
        },
      };
    });
}

export const attackMenuElement: MenuElement = {
  id: Slot.Attack,
  name: "radial_attack",
  disabled: (params: MenuElementParams) => params.game.inSpawnPhase(),
  icon: swordIcon,
  color: COLORS.attack,

  subMenu: (params: MenuElementParams) => {
    if (params === undefined) return [];
    return [
      ...createMenuElements(params, "attack", "attack"),
      // GalloFront aviation: paradrop on land that isn't an ally's
      ...(paradropOffered(params) ? [paradropElement(params)] : []),
    ];
  },
};

// ---- GalloFront aviation ----

/** Reach of the airport pick around the clicked tile (as for the capital). */
const AIRPORT_SELECTION_RADIUS = 5;
/** Shown in tooltips when the engine's buildable list hasn't arrived yet. */
const FIGHTER_COST_FALLBACK = 600_000n;

/** My closest finished airport within reach of the clicked tile, or null. */
export function airportNearTile(params: MenuElementParams) {
  if (typeof params.myPlayer.units !== "function") return null;
  const airports = params.myPlayer
    .units(UnitType.Airport)
    .filter(
      (unit) =>
        !unit.isUnderConstruction() &&
        unit.markedForDeletion() === false &&
        params.game.manhattanDist(unit.tile(), params.tile) <=
          AIRPORT_SELECTION_RADIUS,
    );
  return (
    findClosestBy(airports, (unit) =>
      params.game.manhattanDist(unit.tile(), params.tile),
    ) ?? null
  );
}

/** Fighters already stationed at `airport` (one per airport level). */
function fightersStationed(params: MenuElementParams, airportId: number) {
  return params.myPlayer
    .units(UnitType.Fighter)
    .filter((f) => f.targetUnitId() === airportId).length;
}

function fighterCost(params: MenuElementParams): bigint {
  return (
    params.playerActions.buildableUnits?.find(
      (bu) => bu.type === UnitType.Fighter,
    )?.cost ?? FIGHTER_COST_FALLBACK
  );
}

/**
 * Why a fighter can't be built here: no airport of mine nearby, no free
 * slot on it, no Air Superiority (mil_4) or not enough gold. The engine's
 * canBuild is computed for the clicked tile, so it is not used here: the
 * intent is sent with the airport's own tile.
 */
function fighterBlocked(params: MenuElementParams): boolean {
  if (params.game.inSpawnPhase()) return true;
  const airport = airportNearTile(params);
  if (airport === null) return true;
  const me = params.myPlayer;
  if (lockedBehind(params, UnitType.Fighter) !== null) return true;
  if (me.gold() < fighterCost(params)) return true;
  return fightersStationed(params, airport.id()) >= airport.level();
}

/**
 * The build-submenu entry for a fighter: offered on own territory, enabled
 * only next to one of my airports with a free slot; the intent targets the
 * airport's tile.
 */
function fighterBuildElement(
  item: BuildItemDisplay,
  params: MenuElementParams,
  idPrefix: string,
): MenuElement {
  const airport = airportNearTile(params);
  return {
    id: `${idPrefix}${item.unitType}`,
    name: "fighter",
    disabled: (p: MenuElementParams) => fighterBlocked(p),
    color: (p: MenuElementParams) =>
      fighterBlocked(p) ? COLORS.disabled : COLORS.building,
    icon: item.icon,
    tooltipItems: [
      { text: translateText(item.key ?? ""), className: "title" },
      {
        text: translateText(item.description ?? ""),
        className: "description",
      },
      {
        text: `${renderNumber(fighterCost(params))} ${translateText("player_panel.gold")}`,
        className: "cost",
      },
      airport === null
        ? null
        : {
            text: `${fightersStationed(params, airport.id())}/${airport.level()}`,
            className: "count",
          },
    ].filter((t): t is TooltipItem => t !== null),
    action: (p: MenuElementParams) => {
      const home = airportNearTile(p);
      if (home !== null && !fighterBlocked(p)) {
        p.eventBus.emit(
          new BuildUnitIntentEvent(UnitType.Fighter, home.tile()),
        );
      }
      p.closeMenu();
    },
  };
}

/**
 * Paradrop is offered on land that is not an ally's (own land included: a
 * drop there just reinforces). The engine decides whether an airport in
 * range is ready; the menu only mirrors its buildable list.
 */
function paradropOffered(params: MenuElementParams): boolean {
  if (params.game.inSpawnPhase()) return false;
  if (typeof params.game.isLand !== "function") return false;
  if (!params.game.isLand(params.tile)) return false;
  return !(isFriendlyTarget(params) && !isDisconnectedTarget(params));
}

function paradropBlocked(params: MenuElementParams): boolean {
  if (!paradropOffered(params)) return true;
  return !(
    params.playerActions.buildableUnits?.some(
      (bu) => bu.type === UnitType.AirTransport && bu.canBuild !== false,
    ) ?? false
  );
}

/** GalloFront: "🪂 Paradrop" — the attack ratio of my troops, by air. */
export const paradropMenuElement: MenuElement = {
  id: "paradrop",
  name: "paradrop",
  text: "🪂",
  fontSize: "22px",
  color: (params: MenuElementParams) =>
    paradropBlocked(params) ? COLORS.disabled : COLORS.attack,
  disabled: (params: MenuElementParams) => paradropBlocked(params),
  tooltipKeys: [
    { key: "radial_menu.paradrop", className: "title" },
    { key: "radial_menu.paradrop_desc", className: "description" },
  ],
  action: (params: MenuElementParams) => {
    if (!paradropBlocked(params)) {
      const ratio = params.uiState?.attackRatio ?? 1;
      const troops = Math.floor(ratio * params.myPlayer.troops());
      if (troops > 0) {
        params.eventBus.emit(new SendParadropIntentEvent(params.tile, troops));
      }
    }
    params.closeMenu();
  },
};

/**
 * The paradrop entry, or — while the air transport is still behind its
 * technology — a locked stand-in that taps through to that tech.
 */
function paradropElement(params: MenuElementParams): MenuElement {
  const locked = lockedBehind(params, UnitType.AirTransport);
  if (locked === null) return paradropMenuElement;
  return {
    id: "paradrop",
    name: "paradrop",
    text: "🪂",
    fontSize: "22px",
    color: COLORS.disabled,
    disabled: () => false,
    tooltipItems: [
      { text: translateText("radial_menu.paradrop"), className: "title" },
      ...lockedTooltip(locked),
    ],
    action: (p: MenuElementParams) => openTechPanel(p, locked),
  };
}

const donateGoldRadialElement: MenuElement = {
  id: Slot.Attack,
  name: "radial_donate_gold",
  disabled: (params: MenuElementParams) =>
    params.game.inSpawnPhase() ||
    !params.playerActions?.interaction?.canDonateGold,
  icon: donateGoldIcon,
  color: "#f59e0b",
  action: (params: MenuElementParams) => {
    if (!params.selected) return;
    params.playerPanel.openSendGoldModal(
      params.playerActions,
      params.tile,
      params.selected,
    );
  },
};

export const deleteUnitElement: MenuElement = {
  id: Slot.Delete,
  name: "delete",
  cooldown: (params: MenuElementParams) => params.myPlayer.deleteUnitCooldown(),
  disabled: (params: MenuElementParams) => {
    const tileOwner = params.game.owner(params.tile);
    const isLand = params.game.isLand(params.tile);

    if (!tileOwner.isPlayer() || tileOwner.id() !== params.myPlayer.id()) {
      return true;
    }

    if (!isLand) {
      return true;
    }

    if (params.game.inSpawnPhase()) {
      return true;
    }

    if (params.myPlayer.deleteUnitCooldown() > 0) {
      return true;
    }

    const DELETE_SELECTION_RADIUS = 5;
    const myUnits = params.myPlayer
      .units()
      .filter(
        (unit) =>
          !unit.isUnderConstruction() &&
          unit.markedForDeletion() === false &&
          Structures.has(unit.type()) &&
          params.game.manhattanDist(unit.tile(), params.tile) <=
            DELETE_SELECTION_RADIUS,
      );

    return myUnits.length === 0;
  },
  icon: xIcon,
  color: COLORS.delete,
  tooltipKeys: [
    {
      key: "radial_menu.delete_unit_title",
      className: "title",
    },
    {
      key: "radial_menu.delete_unit_description",
      className: "description",
    },
  ],
  action: (params: MenuElementParams) => {
    const DELETE_SELECTION_RADIUS = 5;
    const myUnits = params.myPlayer
      .units()
      .filter(
        (unit) =>
          !unit.isUnderConstruction() &&
          unit.markedForDeletion() === false &&
          Structures.has(unit.type()) &&
          params.game.manhattanDist(unit.tile(), params.tile) <=
            DELETE_SELECTION_RADIUS,
      );

    const closestUnit = findClosestBy(myUnits, (unit) =>
      params.game.manhattanDist(unit.tile(), params.tile),
    );
    if (closestUnit) {
      params.playerActionHandler.handleDeleteUnit(closestUnit.id());
    }

    params.closeMenu();
  },
};

// GalloFront capital: the player's closest finished city within this many
// tiles of the clicked tile (same reach as the delete button).
const CAPITAL_SELECTION_RADIUS = 5;

export function cityNearTile(params: MenuElementParams) {
  const cities = params.myPlayer
    .units(UnitType.City)
    .filter(
      (unit) =>
        !unit.isUnderConstruction() &&
        unit.markedForDeletion() === false &&
        params.game.manhattanDist(unit.tile(), params.tile) <=
          CAPITAL_SELECTION_RADIUS,
    );
  return (
    findClosestBy(cities, (unit) =>
      params.game.manhattanDist(unit.tile(), params.tile),
    ) ?? null
  );
}

/**
 * GalloFront: make the city under the cursor the capital. Only offered on
 * own territory with a city nearby; disabled when that city already is the
 * capital. The 3-minute move cooldown is only known to the engine, which
 * refuses silently.
 */
export const setCapitalElement: MenuElement = {
  id: "set_capital",
  name: "capital",
  text: "👑",
  fontSize: "22px",
  color: COLORS.build,
  disabled: (params: MenuElementParams) => {
    if (params.game.inSpawnPhase()) return true;
    const city = cityNearTile(params);
    if (city === null) return true;
    return params.myPlayer.capitalTile() === city.tile();
  },
  tooltipKeys: [
    {
      key: "radial_menu.set_capital",
      className: "title",
    },
    {
      key: "radial_menu.set_capital_desc",
      className: "description",
    },
  ],
  action: (params: MenuElementParams) => {
    const city = cityNearTile(params);
    if (city !== null && params.myPlayer.capitalTile() !== city.tile()) {
      params.eventBus.emit(new SendSetCapitalIntentEvent(city.tile()));
    }
    params.closeMenu();
  },
};

// ---- GalloFront espionage ----

/** Structures a spy can sabotage (finished ones, owned by the target). */
const SABOTAGE_TYPES: readonly UnitType[] = [
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
  UnitType.City,
  UnitType.Port,
  UnitType.Factory,
  UnitType.DefensePost,
];
/** Reach of the sabotage pick around the clicked tile (as for the capital). */
const SABOTAGE_SELECTION_RADIUS = 5;
/** Shown in tooltips when the engine's buildable list hasn't arrived yet. */
const SPY_COST_FALLBACK = 300_000n;

/**
 * The selected player when they are a valid spy target: another, living
 * player who is neither allied nor on my team. The menu is built from
 * partial stubs in tests, so missing methods count as "not an enemy".
 */
export function enemyTarget(params: MenuElementParams): PlayerView | null {
  const selected = params.selected;
  if (selected === null || selected === params.myPlayer) return null;
  if (
    typeof selected.isAlive !== "function" ||
    typeof selected.isFriendly !== "function" ||
    typeof selected.id !== "function"
  ) {
    return null;
  }
  if (selected.id() === params.myPlayer.id()) return null;
  if (!selected.isAlive() || selected.isFriendly(params.myPlayer)) return null;
  return selected;
}

/** The spy's cost, from the engine's buildable list when it has arrived. */
function spyCost(params: MenuElementParams): bigint {
  return (
    params.playerActions.buildableUnits?.find((bu) => bu.type === UnitType.Spy)
      ?.cost ?? SPY_COST_FALLBACK
  );
}

/** The target's closest finished structure to the clicked tile, or null. */
export function sabotageTargetNearTile(params: MenuElementParams) {
  const target = enemyTarget(params);
  if (target === null || typeof target.units !== "function") return null;
  const structures = target
    .units(...SABOTAGE_TYPES)
    .filter(
      (unit) =>
        !unit.isUnderConstruction() &&
        unit.markedForDeletion() === false &&
        params.game.manhattanDist(unit.tile(), params.tile) <=
          SABOTAGE_SELECTION_RADIUS,
    );
  return (
    findClosestBy(structures, (unit) =>
      params.game.manhattanDist(unit.tile(), params.tile),
    ) ?? null
  );
}

/** Why a spy can't be sent right now (shared by the three missions). */
function spyBlocked(params: MenuElementParams): boolean {
  const me = params.myPlayer;
  if (params.game.inSpawnPhase() || enemyTarget(params) === null) return true;
  if (lockedBehind(params, UnitType.Spy) !== null) return true;
  if (me.gold() < spyCost(params)) return true;
  return me.units(UnitType.Spy).length >= params.game.config().maxSpies();
}

function spyMissionElement(
  mission: SpyMission,
  key: "spy_reveal" | "spy_steal" | "spy_sabotage",
  text: string,
): MenuElement {
  const sabotage = mission === SpyMission.Sabotage;
  return {
    id: key,
    name: key,
    text,
    fontSize: "22px",
    color: (params: MenuElementParams) =>
      spyBlocked(params) ||
      (sabotage && sabotageTargetNearTile(params) === null)
        ? COLORS.disabled
        : COLORS.spy,
    disabled: (params: MenuElementParams) =>
      spyBlocked(params) ||
      (sabotage && sabotageTargetNearTile(params) === null),
    tooltipKeys: [
      { key: `radial_menu.${key}`, className: "title" },
      { key: `radial_menu.${key}_desc`, className: "description" },
    ],
    action: (params: MenuElementParams) => {
      const target = enemyTarget(params);
      if (target !== null && !spyBlocked(params)) {
        if (sabotage) {
          const unit = sabotageTargetNearTile(params);
          if (unit !== null) {
            params.eventBus.emit(
              new SendSpyIntentEvent(target.id(), mission, unit.id()),
            );
          }
        } else {
          params.eventBus.emit(new SendSpyIntentEvent(target.id(), mission));
        }
      }
      params.closeMenu();
    },
  };
}

/**
 * GalloFront: "🕵 Spy" submenu on an enemy player — reveal, steal or
 * sabotage. Needs the spy's technology (Config.unitRequiredTech: Radar,
 * def_2), 300k gold and fewer than three spies in flight; the engine also
 * enforces a 20 s cooldown.
 */
export const spyMenuElement: MenuElement = {
  id: "spy",
  name: "spy",
  text: "🕵",
  fontSize: "22px",
  color: (params: MenuElementParams) =>
    spyBlocked(params) ? COLORS.disabled : COLORS.spy,
  disabled: (params: MenuElementParams) => spyBlocked(params),
  tooltipKeys: [
    { key: "radial_menu.spy", className: "title" },
    { key: "radial_menu.spy_desc", className: "description" },
  ],
  subMenu: () => [
    spyMissionElement(SpyMission.Reveal, "spy_reveal", "👁"),
    spyMissionElement(SpyMission.Steal, "spy_steal", "💰"),
    spyMissionElement(SpyMission.Sabotage, "spy_sabotage", "💣"),
  ],
};

/**
 * The spy entry, or — before its technology — a locked stand-in that taps
 * through to that tech instead of a submenu.
 */
function spyElement(params: MenuElementParams): MenuElement {
  const locked = lockedBehind(params, UnitType.Spy);
  if (locked === null) return spyMenuElement;
  return {
    id: "spy",
    name: "spy",
    text: "🕵",
    fontSize: "22px",
    color: COLORS.disabled,
    disabled: () => false,
    tooltipItems: [
      { text: translateText("radial_menu.spy"), className: "title" },
      ...lockedTooltip(locked),
    ],
    action: (p: MenuElementParams) => openTechPanel(p, locked),
  };
}

export const buildMenuElement: MenuElement = {
  id: Slot.Build,
  name: "build",
  disabled: (params: MenuElementParams) => params.game.inSpawnPhase(),
  icon: buildIcon,
  color: COLORS.build,

  subMenu: (params: MenuElementParams) => {
    if (params === undefined) return [];
    return createMenuElements(params, "build", "build");
  },
};

export const boatMenuElement: MenuElement = {
  id: Slot.Boat,
  name: "boat",
  disabled: (params: MenuElementParams) =>
    !params.playerActions.buildableUnits.some(
      (unit) => unit.type === UnitType.TransportShip && unit.canBuild,
    ),
  icon: boatIcon,
  color: COLORS.boat,

  action: async (params: MenuElementParams) => {
    params.playerActionHandler.handleBoatAttack(params.myPlayer, params.tile);

    params.closeMenu();
  },
};

export const centerButtonElement: CenterButtonElement = {
  disabled: (params: MenuElementParams): boolean => {
    const tileOwner = params.game.owner(params.tile);
    const isLand = params.game.isLand(params.tile);
    if (!isLand) {
      return true;
    }
    if (params.game.inSpawnPhase()) {
      if (params.game.config().isRandomSpawn()) {
        return true;
      }
      if (tileOwner.isPlayer()) {
        return true;
      }
      return false;
    }

    if (isFriendlyTarget(params) && !isDisconnectedTarget(params)) {
      return !params.playerActions.interaction?.canDonateTroops;
    }

    return !params.playerActions.canAttack;
  },
  action: (params: MenuElementParams) => {
    if (params.game.inSpawnPhase()) {
      params.playerActionHandler.handleSpawn(params.tile);
    } else {
      if (isFriendlyTarget(params) && !isDisconnectedTarget(params)) {
        const selectedPlayer = params.selected as PlayerView;
        const ratio = params.uiState?.attackRatio ?? 1;
        const troopsToDonate = Math.floor(ratio * params.myPlayer.troops());
        if (troopsToDonate > 0) {
          params.playerActionHandler.handleDonateTroops(
            selectedPlayer,
            troopsToDonate,
          );
        }
      } else {
        params.playerActionHandler.handleAttack(
          params.myPlayer,
          params.selected?.id() ?? null,
        );
      }
    }
    params.closeMenu();
  },
};

export const rootMenuElement: MenuElement = {
  id: "root",
  name: "root",
  disabled: () => false,
  icon: infoIcon,
  color: COLORS.info,
  subMenu: (params: MenuElementParams) => {
    const isAllied = params.selected?.isAlliedWith(params.myPlayer);
    const isDisconnected = isDisconnectedTarget(params);

    const tileOwner = params.game.owner(params.tile);
    const isOwnTerritory =
      tileOwner.isPlayer() &&
      (tileOwner as PlayerView).id() === params.myPlayer.id();

    const inExtensionWindow =
      params.playerActions.interaction?.allianceInfo?.inExtensionWindow;

    // After game-over, nukes can target teammates in multiplayer (nukeSpawn allows it,
    // but not in singleplayer). Show the attack submenu so mobile users can access
    // nukes in the aftergame.
    const hasBuildableAttacks =
      params.playerActions.buildableUnits?.some(
        (bu) => BuildableAttacks.has(bu.type) && bu.canBuild !== false,
      ) ?? false;

    const showDonateInsteadOfAttack =
      isFriendlyTarget(params) && !isDisconnected && !hasBuildableAttacks;

    // GalloFront: a 5th slot on own territory when a city is under the cursor
    const hasCityHere = isOwnTerritory && cityNearTile(params) !== null;
    // GalloFront: a 5th slot on an enemy player for the spy missions
    const canSpyOn = !isOwnTerritory && enemyTarget(params) !== null;

    const menuItems: (MenuElement | null)[] = [
      infoMenuElement,
      ...(isOwnTerritory
        ? [
            deleteUnitElement,
            allyRequestElement,
            buildMenuElement,
            ...(hasCityHere ? [setCapitalElement] : []),
          ]
        : [
            isAllied && !isDisconnected ? allyBreakElement : boatMenuElement,
            inExtensionWindow ? allyExtendElement : allyRequestElement,
            showDonateInsteadOfAttack
              ? donateGoldRadialElement
              : attackMenuElement,
            ...(canSpyOn ? [spyElement(params)] : []),
          ]),
    ];

    return menuItems.filter((item): item is MenuElement => item !== null);
  },
};
