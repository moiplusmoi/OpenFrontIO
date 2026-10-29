import {
  BuildableUnit,
  BuildMenus,
  Gold,
  isNavalCombatant,
  PlayerBuildableUnitType,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { renderNumber } from "@openfront/engine-lib/Format";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import "../../components/ui/Icon";
import { Controller } from "../../Controller";
import {
  ToggleBatchPlaceEvent,
  ToggleStructureEvent,
} from "../../InputHandler";
import { Platform } from "../../Platform";
import { UIState } from "../../UIState";
import { UserSettings } from "../../UserSettings";
import { translateText } from "../../Utils";
import { GameView } from "../../view";
import {
  airportIcon,
  atomBombIcon,
  cityIcon,
  defensePostIcon,
  factoryIcon,
  goldCoinIcon,
  hydrogenBombIcon,
  mirvIcon,
  missileSiloIcon,
  portIcon,
  samLauncherIcon,
  warshipIcon,
} from "../HotbarIcons";
import { TutorialHighlight, TutorialHighlightEvent } from "../Tutorial";
import { missingTech, requiresTechLabel, techName } from "./TechLock";
import { ShowTechPanelEvent } from "./TechPanelEvents";

/**
 * Touch devices get no hover tooltip: a tap fires mouseenter, the tooltip
 * appeared inside the scrolling row, the row grew a scrollbar, the item
 * moved out from under the finger, mouseleave fired, and so on — the
 * "shivering" build bar. The name and cost sit under the icon instead.
 */
function hoverTooltips(): boolean {
  return !Platform.isTouch;
}

@customElement("unit-display")
export class UnitDisplay extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  private playerBuildables: BuildableUnit[] | null = null;
  private keybinds: Record<string, { value: string; key: string }> = {};
  private _cities = 0;
  private _warships = 0;
  private _factories = 0;
  private _missileSilo = 0;
  private _port = 0;
  private _defensePost = 0;
  private _samLauncher = 0;
  private _airports = 0;
  private allDisabled = false;
  private _hoveredUnit: PlayerBuildableUnitType | null = null;
  private tutorialHighlight: PlayerBuildableUnitType | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    const config = this.game.config();
    const userSettings = new UserSettings();

    this.keybinds = userSettings.parsedUserKeybinds();

    this.allDisabled = BuildMenus.types.every((u) => config.isUnitDisabled(u));

    const highlightUnits: Partial<
      Record<TutorialHighlight, PlayerBuildableUnitType>
    > = {
      city: UnitType.City,
      port: UnitType.Port,
      defense_post: UnitType.DefensePost,
      factory: UnitType.Factory,
      warship: UnitType.Warship,
      silo: UnitType.MissileSilo,
      atom: UnitType.AtomBomb,
      hydrogen: UnitType.HydrogenBomb,
      mirv: UnitType.MIRV,
      sam: UnitType.SAMLauncher,
    };
    this.eventBus.on(TutorialHighlightEvent, (e) => {
      this.tutorialHighlight = (e.target && highlightUnits[e.target]) ?? null;
      this.requestUpdate();
    });
    this.requestUpdate();
  }

  private cost(item: UnitType): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item) {
        return bu.cost;
      }
    }
    return 0n;
  }

  private canBuild(item: UnitType): boolean {
    if (this.game?.config().isUnitDisabled(item)) return false;
    const player = this.game?.myPlayer();
    switch (item) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.MissileSilo).length ?? 0) > 0
        );
      case UnitType.Warship:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.Port).length ?? 0) > 0
        );
      default:
        return this.cost(item) <= (player?.gold() ?? 0n);
    }
  }

  /** Counts and costs change slowly; 10 Hz re-renders only cost battery. */
  getTickIntervalMs() {
    return 250;
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player) return;
    player.buildables(undefined, BuildMenus.types).then((buildables) => {
      this.playerBuildables = buildables;
    });
    this._cities = player.totalUnitLevels(UnitType.City);
    this._missileSilo = player.totalUnitLevels(UnitType.MissileSilo);
    this._port = player.totalUnitLevels(UnitType.Port);
    this._defensePost = player.totalUnitLevels(UnitType.DefensePost);
    this._samLauncher = player.totalUnitLevels(UnitType.SAMLauncher);
    this._factories = player.totalUnitLevels(UnitType.Factory);
    this._warships = player.totalUnitLevels(UnitType.Warship);
    this._airports = player.totalUnitLevels(UnitType.Airport);
    this.requestUpdate();
  }

  render() {
    const myPlayer = this.game?.myPlayer();
    if (
      !this.game ||
      !myPlayer ||
      this.game.inSpawnPhase() ||
      !myPlayer.isAlive()
    ) {
      return null;
    }
    if (this.allDisabled) {
      return null;
    }

    // The one tooltip lives OUTSIDE the scrolling row (absolute, no
    // pointer events, anchored to this wrapper), so showing it can never
    // change the row's size or scrollbars.
    return html`
      <div class="relative border-t border-white/10 p-0.5 w-full">
        ${this.renderTooltip()}
        <div
          class="grid grid-cols-6 gap-1 w-full lg:w-fit lg:grid-cols-none lg:grid-rows-1 lg:grid-flow-col lg:gap-0.5 lg:mx-auto lg:overflow-x-auto lg:overflow-y-hidden lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden"
        >
          ${this.renderUnitItem(
            cityIcon,
            this._cities,
            UnitType.City,
            "city",
            this.keybinds["buildCity"]?.key ?? "1",
          )}
          ${this.renderUnitItem(
            factoryIcon,
            this._factories,
            UnitType.Factory,
            "factory",
            this.keybinds["buildFactory"]?.key ?? "2",
          )}
          ${this.renderUnitItem(
            portIcon,
            this._port,
            UnitType.Port,
            "port",
            this.keybinds["buildPort"]?.key ?? "3",
          )}
          ${this.renderUnitItem(
            defensePostIcon,
            this._defensePost,
            UnitType.DefensePost,
            "defense_post",
            this.keybinds["buildDefensePost"]?.key ?? "4",
          )}
          ${this.renderUnitItem(
            missileSiloIcon,
            this._missileSilo,
            UnitType.MissileSilo,
            "missile_silo",
            this.keybinds["buildMissileSilo"]?.key ?? "5",
          )}
          ${this.renderUnitItem(
            samLauncherIcon,
            this._samLauncher,
            UnitType.SAMLauncher,
            "sam_launcher",
            this.keybinds["buildSamLauncher"]?.key ?? "6",
          )}
          ${this.renderUnitItem(
            warshipIcon,
            this._warships,
            UnitType.Warship,
            "warship",
            this.keybinds["buildWarship"]?.key ?? "7",
          )}
          ${this.renderUnitItem(
            atomBombIcon,
            null,
            UnitType.AtomBomb,
            "atom_bomb",
            this.keybinds["buildAtomBomb"]?.key ?? "8",
          )}
          ${this.renderUnitItem(
            hydrogenBombIcon,
            null,
            UnitType.HydrogenBomb,
            "hydrogen_bomb",
            this.keybinds["buildHydrogenBomb"]?.key ?? "9",
          )}
          ${this.renderUnitItem(
            mirvIcon,
            null,
            UnitType.MIRV,
            "mirv",
            this.keybinds["buildMIRV"]?.key ?? "0",
          )}
          ${this.renderUnitItem(
            airportIcon,
            this._airports,
            UnitType.Airport,
            "airport",
            this.keybinds["buildAirport"]?.key ?? "O",
          )}
          ${this.renderMultiToggle()}
        </div>
      </div>
    `;
  }

  /**
   * Touch equivalent of holding Shift (or the batchPlace key): keeps a naval
   * ghost armed after each placement. Phones only; desktop keeps the keys.
   */
  private renderMultiToggle() {
    const ghost = this.uiState.ghostStructure;
    if (ghost === null || !isNavalCombatant(ghost)) return null;
    const on = this.uiState.batchPlace;
    return html`
      <button
        class="flex items-center justify-center min-w-0 w-full min-h-11 border rounded-sm text-xs font-bold lg:hidden ${on
          ? "border-sky-400 bg-sky-400/20 text-white"
          : "border-slate-500 text-gray-300"}"
        title=${translateText("build_menu.multi_place_title")}
        aria-pressed=${on ? "true" : "false"}
        @click=${() => {
          this.eventBus.emit(new ToggleBatchPlaceEvent());
          this.requestUpdate();
        }}
      >
        ${translateText("build_menu.multi_place")}
      </button>
    `;
  }

  /** Which hotbar entry the tooltip describes: name, hotkey and cost. */
  private readonly structureKeys = new Map<PlayerBuildableUnitType, string>();
  private readonly hotkeys = new Map<PlayerBuildableUnitType, string>();

  private renderTooltip() {
    const unitType = this._hoveredUnit;
    if (unitType === null || !hoverTooltips()) return null;
    const structureKey = this.structureKeys.get(unitType) ?? "";
    const hotkey = this.hotkeys.get(unitType) ?? "";
    const locked = missingTech(
      this.game?.config(),
      this.game?.myPlayer(),
      unitType,
    );
    return html`
      <div
        class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-gray-200 text-center w-max max-w-[90vw] text-xs bg-gray-800/90 backdrop-blur-xs rounded-sm p-1 z-[100] shadow-lg pointer-events-none"
      >
        <div class="font-bold text-sm mb-1">
          ${translateText("unit_type." + structureKey)}${` [${hotkey}]`}
        </div>
        <div class="p-2">
          ${translateText("build_menu.desc." + structureKey)}
        </div>
        ${isNavalCombatant(unitType)
          ? html`<div
              class="mt-1 px-2 py-1 text-[10px] text-cyan-300 border-t border-white/10"
            >
              ⇧ ${translateText("build_menu.warship_shift_hint")}
            </div>`
          : null}
        ${locked !== null
          ? html`<div class="text-amber-300">
              ${requiresTechLabel(locked)} ·
              ${translateText("build_menu.requires_tech_tap")}
            </div>`
          : html`<div class="flex items-center justify-center gap-1">
              <img src=${goldCoinIcon} width="13" height="13" />
              <span class="text-yellow-300"
                >${renderNumber(this.cost(unitType))}</span
              >
            </div>`}
      </div>
    `;
  }

  private onItemClick(
    unitType: PlayerBuildableUnitType,
    locked: TechId | null,
  ) {
    if (locked !== null) {
      // A locked unit taps through to the technology that opens it.
      this.uiState.ghostStructure = null;
      this.eventBus?.emit(new ShowTechPanelEvent(true, locked));
    } else if (this.uiState.ghostStructure === unitType) {
      this.uiState.ghostStructure = null;
    } else if (this.canBuild(unitType)) {
      this.uiState.ghostStructure = unitType;
    }
    this.requestUpdate();
  }

  private highlightStructures(unitType: PlayerBuildableUnitType) {
    switch (unitType) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
        this.eventBus?.emit(
          new ToggleStructureEvent([
            UnitType.MissileSilo,
            UnitType.SAMLauncher,
          ]),
        );
        break;
      case UnitType.Warship:
        this.eventBus?.emit(new ToggleStructureEvent([UnitType.Port]));
        break;
      default:
        this.eventBus?.emit(new ToggleStructureEvent([unitType]));
    }
  }

  private renderUnitItem(
    icon: string,
    number: number | null,
    unitType: PlayerBuildableUnitType,
    structureKey: string,
    hotkey: string,
  ) {
    if (this.game.config().isUnitDisabled(unitType)) {
      return html``;
    }
    const selected = this.uiState.ghostStructure === unitType;
    const displayHotkey = hotkey
      .replace("Digit", "")
      .replace("Key", "")
      .toUpperCase();
    this.structureKeys.set(unitType, structureKey);
    this.hotkeys.set(unitType, displayHotkey);
    const locked = missingTech(
      this.game.config(),
      this.game.myPlayer(),
      unitType,
    );
    const hover = hoverTooltips();
    // On touch the hover handlers are simply not attached: nothing runs on a
    // tap except the click, so nothing can re-layout under the finger.
    const onEnter = hover
      ? () => {
          this._hoveredUnit = unitType;
          this.highlightStructures(unitType);
          this.requestUpdate();
        }
      : null;
    const onLeave = hover
      ? () => {
          this._hoveredUnit = null;
          this.eventBus?.emit(new ToggleStructureEvent(null));
          this.requestUpdate();
        }
      : null;

    return html`
      <div
        class="flex flex-col items-center min-w-0 w-full lg:w-auto lg:min-w-0 select-none"
        @mouseenter=${onEnter}
        @mouseleave=${onLeave}
      >
        <div
          class="${locked !== null
            ? "opacity-70 border-dashed border-amber-600"
            : this.canBuild(unitType)
              ? "border-slate-500"
              : "opacity-40 border-slate-500"} border rounded-sm px-0.5 pb-0.5 w-full lg:w-auto min-h-11 lg:min-h-0 flex items-center justify-center gap-0.5 cursor-pointer
             ${hover
            ? selected
              ? "hover:bg-gray-400/10"
              : "hover:bg-gray-800"
            : ""}
             text-white ${selected ? "bg-slate-400/20" : ""}
             ${this.tutorialHighlight === unitType ? "tutorial-highlight" : ""}"
          title=${hover
            ? ""
            : locked !== null
              ? requiresTechLabel(locked)
              : translateText("unit_type." + structureKey)}
          @click=${() => this.onItemClick(unitType, locked)}
        >
          <div class="ml-0.5 text-[10px] relative -top-1 text-gray-400">
            ${displayHotkey}
          </div>
          <div class="flex items-center gap-0.5 pt-0.5">
            <img
              src=${icon}
              alt=${structureKey}
              class="align-middle size-7 lg:size-5"
            />
            ${locked !== null
              ? html`<of-icon name="lock" size="12"></of-icon>`
              : number !== null
                ? html`<span class="text-xs">${renderNumber(number)}</span>`
                : null}
          </div>
        </div>
        ${hover
          ? null
          : html`<div
              class="h-3.5 max-w-full lg:max-w-12 truncate text-[9px] leading-[14px] tabular-nums ${locked !==
              null
                ? "text-amber-300"
                : "text-yellow-300"}"
              translate="no"
            >
              ${locked !== null
                ? techName(locked)
                : renderNumber(this.cost(unitType))}
            </div>`}
      </div>
    `;
  }
}
