import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  BuildableUnit,
  BuildMenus,
  Gold,
  PlayerBuildableUnitType,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { renderNumber } from "@openfront/engine-lib/Format";
import { findClosestBy } from "@openfront/engine-lib/Util";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { EventBus } from "@openfront/shared/EventBus";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { Controller } from "../../Controller";
import {
  CloseViewEvent,
  MouseDownEvent,
  ShowBuildMenuEvent,
  ShowEmojiMenuEvent,
} from "../../InputHandler";
import { TransformHandler } from "../../TransformHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../Transport";
import { UIState } from "../../UIState";
import { GameView } from "../../view";
import { missingTech, requiresTechLabel } from "./TechLock";
import { ShowTechPanelEvent } from "./TechPanelEvents";
const warshipIcon = assetUrl("images/BattleshipIconWhite.svg");
// No dedicated frigate art yet: the small boat stands in for it.
const frigateIcon = assetUrl("images/BoatIconWhite.svg");
const destroyerIcon = assetUrl("images/DestroyerIconWhite.svg");
const cityIcon = assetUrl("images/CityIconWhite.svg");
const factoryIcon = assetUrl("images/FactoryIconWhite.svg");
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const mirvIcon = assetUrl("images/MIRVIcon.svg");
const missileSiloIcon = assetUrl("images/MissileSiloIconWhite.svg");
const hydrogenBombIcon = assetUrl("images/MushroomCloudIconWhite.svg");
const atomBombIcon = assetUrl("images/NukeIconWhite.svg");
const portIcon = assetUrl("images/PortIcon.svg");
const samlauncherIcon = assetUrl("images/SamLauncherIconWhite.svg");
const shieldIcon = assetUrl("images/ShieldIconWhite.svg");
// GalloFront aviation
const airportIcon = assetUrl("images/AirportIconWhite.svg");
const bomberIcon = assetUrl("images/BomberIconWhite.svg");
const fighterIcon = assetUrl("images/FighterIconWhite.svg");

export interface BuildItemDisplay {
  unitType: PlayerBuildableUnitType;
  icon: string;
  description?: string;
  key?: string;
  countable?: boolean;
}

export const buildTable: BuildItemDisplay[][] = [
  [
    {
      unitType: UnitType.AtomBomb,
      icon: atomBombIcon,
      description: "build_menu.desc.atom_bomb",
      key: "unit_type.atom_bomb",
      countable: false,
    },
    {
      unitType: UnitType.MIRV,
      icon: mirvIcon,
      description: "build_menu.desc.mirv",
      key: "unit_type.mirv",
      countable: false,
    },
    {
      unitType: UnitType.HydrogenBomb,
      icon: hydrogenBombIcon,
      description: "build_menu.desc.hydrogen_bomb",
      key: "unit_type.hydrogen_bomb",
      countable: false,
    },
    {
      unitType: UnitType.Warship,
      icon: warshipIcon,
      description: "build_menu.desc.warship",
      key: "unit_type.warship",
      countable: true,
    },
    {
      unitType: UnitType.Frigate,
      icon: frigateIcon,
      description: "build_menu.desc.frigate",
      key: "unit_type.frigate",
      countable: true,
    },
    {
      unitType: UnitType.Destroyer,
      icon: destroyerIcon,
      description: "build_menu.desc.destroyer",
      key: "unit_type.destroyer",
      countable: true,
    },
    {
      unitType: UnitType.Port,
      icon: portIcon,
      description: "build_menu.desc.port",
      key: "unit_type.port",
      countable: true,
    },
    {
      unitType: UnitType.MissileSilo,
      icon: missileSiloIcon,
      description: "build_menu.desc.missile_silo",
      key: "unit_type.missile_silo",
      countable: true,
    },
    {
      unitType: UnitType.SAMLauncher,
      icon: samlauncherIcon,
      description: "build_menu.desc.sam_launcher",
      key: "unit_type.sam_launcher",
      countable: true,
    },
    {
      unitType: UnitType.DefensePost,
      icon: shieldIcon,
      description: "build_menu.desc.defense_post",
      key: "unit_type.defense_post",
      countable: true,
    },
    {
      unitType: UnitType.City,
      icon: cityIcon,
      description: "build_menu.desc.city",
      key: "unit_type.city",
      countable: true,
    },
    {
      unitType: UnitType.Factory,
      icon: factoryIcon,
      description: "build_menu.desc.factory",
      key: "unit_type.factory",
      countable: true,
    },
    // GalloFront aviation (gated by Config.unitRequiredTech)
    {
      unitType: UnitType.Airport,
      icon: airportIcon,
      description: "build_menu.desc.airport",
      key: "unit_type.airport",
      countable: true,
    },
    {
      unitType: UnitType.Bomber,
      icon: bomberIcon,
      description: "build_menu.desc.bomber",
      key: "unit_type.bomber",
      countable: false,
    },
    {
      unitType: UnitType.Fighter,
      icon: fighterIcon,
      description: "build_menu.desc.fighter",
      key: "unit_type.fighter",
      countable: false,
    },
  ],
];

export const flattenedBuildTable = buildTable.flat();

@customElement("build-menu")
export class BuildMenu extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  private clickedTile: TileRef;
  public playerBuildables: BuildableUnit[] | null = null;
  private filteredBuildTable: BuildItemDisplay[][] = buildTable;
  public transformHandler: TransformHandler;

  init() {
    this.eventBus.on(ShowBuildMenuEvent, (e) => {
      if (!this.game.myPlayer()?.isAlive()) {
        return;
      }
      if (!this._hidden) {
        // Players sometimes hold control while building a unit,
        // so if the menu is already open, ignore the event.
        return;
      }
      const clickedCell = this.transformHandler.screenToWorldCoordinates(
        e.x,
        e.y,
      );
      if (!this.game.isValidCoord(clickedCell.x, clickedCell.y)) {
        return;
      }
      const tile = this.game.ref(clickedCell.x, clickedCell.y);
      this.showMenu(tile);
    });
    this.eventBus.on(CloseViewEvent, () => this.hideMenu());
    this.eventBus.on(ShowEmojiMenuEvent, () => this.hideMenu());
    this.eventBus.on(MouseDownEvent, () => this.hideMenu());
  }

  tick() {
    if (!this._hidden) {
      this.refresh();
    }
  }

  /**
   * Gold moves every tick, but re-rendering a dozen buttons at 10 Hz on a
   * phone is what kept the menu "shivering"; twice a second is plenty.
   */
  getTickIntervalMs() {
    return 500;
  }

  static styles = css`
    :host {
      display: block;
    }
    * {
      box-sizing: border-box;
    }
    .build-menu {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 9999;
      background-color: var(--color-hud);
      padding: 15px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      border: 1px solid var(--color-hud-line);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      max-width: 95vw;
      max-height: 95vh;
      /* Never horizontal: a scrollbar that comes and goes resizes the rows. */
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .build-description {
      font-size: 0.6rem;
    }
    .build-row {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      width: 100%;
    }
    .build-button {
      position: relative;
      width: 120px;
      height: 140px;
      border: 1px solid var(--color-hud-line);
      background-color: var(--color-hud-raised);
      color: white;
      border-radius: 8px;
      cursor: pointer;
      transition:
        background-color 0.15s ease,
        border-color 0.15s ease;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      margin: 8px;
      padding: 10px;
      gap: 5px;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    /* Hover effects only where hovering exists: on a phone the tap leaves a
       sticky :hover behind, and the scale transition read as a jitter. */
    @media (hover: hover) {
      .build-button:not(:disabled):hover {
        background-color: #1b3152;
        border-color: rgba(63, 169, 245, 0.5);
      }
    }
    .build-button:not(:disabled):active {
      background-color: #234670;
      transform: scale(0.98);
    }
    .build-button.locked {
      border-style: dashed;
      border-color: #b45309;
      background-color: #0a1421;
    }
    .build-button.locked img {
      opacity: 0.5;
    }
    .build-lock {
      font-size: 11px;
      line-height: 1.2;
      color: #fbbf24;
      text-align: center;
    }
    .build-button:disabled {
      background-color: #0a1421;
      border-color: var(--color-hud-line);
      cursor: not-allowed;
      opacity: 0.7;
    }
    .build-button:disabled img {
      opacity: 0.5;
    }
    .build-button:disabled .build-cost {
      color: #ff4444;
    }
    .build-icon {
      font-size: 40px;
      margin-bottom: 5px;
    }
    .build-name {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 5px;
      text-align: center;
    }
    .build-cost {
      font-size: 14px;
    }
    .hidden {
      display: none !important;
    }
    .build-count-chip {
      position: absolute;
      top: -10px;
      right: -10px;
      background-color: var(--color-hud-raised);
      color: white;
      padding: 2px 10px;
      border-radius: 10000px;
      transition: all 0.3s ease;
      font-size: 12px;
      display: flex;
      justify-content: center;
      align-content: center;
      border: 1px solid var(--color-hud-line);
    }
    @media (hover: hover) {
      .build-button:not(:disabled):hover > .build-count-chip {
        background-color: #1b3152;
        border-color: rgba(63, 169, 245, 0.5);
      }
    }
    .build-button:not(:disabled):active > .build-count-chip {
      background-color: #234670;
    }
    .build-button:disabled > .build-count-chip {
      background-color: #0a1421;
      border-color: var(--color-hud-line);
      cursor: not-allowed;
    }
    .build-count {
      font-weight: bold;
      font-size: 14px;
    }

    @media (max-width: 768px) {
      .build-menu {
        padding: 10px;
        max-height: 80vh;
        width: 80vw;
      }
      .build-button {
        width: 140px;
        height: 120px;
        margin: 4px;
        padding: 6px;
        gap: 5px;
      }
      .build-icon {
        font-size: 28px;
      }
      .build-name {
        font-size: 12px;
        margin-bottom: 3px;
      }
      .build-cost {
        font-size: 11px;
      }
      .build-count {
        font-weight: bold;
        font-size: 10px;
      }
      .build-count-chip {
        padding: 1px 5px;
      }
    }

    @media (max-width: 480px) {
      .build-menu {
        padding: 8px;
        max-height: 70vh;
      }
      .build-button {
        width: calc(50% - 6px);
        height: 100px;
        margin: 3px;
        padding: 4px;
        border-width: 1px;
      }
      .build-icon {
        font-size: 24px;
      }
      .build-name {
        font-size: 10px;
        margin-bottom: 2px;
      }
      .build-cost {
        font-size: 9px;
      }
      .build-count {
        font-weight: bold;
        font-size: 8px;
      }
      .build-count-chip {
        padding: 0 3px;
      }
      .build-button img {
        width: 24px;
        height: 24px;
      }
      .build-cost img {
        width: 10px;
        height: 10px;
      }
    }
  `;

  @state()
  private _hidden = true;

  public canBuildOrUpgrade(item: BuildItemDisplay): boolean {
    if (this.game?.myPlayer() === null || this.playerBuildables === null) {
      return false;
    }
    const unit = this.playerBuildables.find((u) => u.type === item.unitType);
    return unit ? unit.canBuild !== false || unit.canUpgrade !== false : false;
  }

  public cost(item: BuildItemDisplay): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item.unitType) {
        return bu.cost;
      }
    }
    return 0n;
  }

  public count(item: BuildItemDisplay): string {
    const player = this.game?.myPlayer();
    if (!player) {
      return "?";
    }

    return player.totalUnitLevels(item.unitType).toString();
  }

  /**
   * GalloFront aviation: a fighter is stationed at one of my airports, so
   * the engine's canBuild (computed for the clicked tile) is replaced by
   * "my closest finished airport within 5 tiles with a free slot".
   */
  private fighterHome(): TileRef | null {
    const me = this.game?.myPlayer();
    if (!me || this.clickedTile === undefined) return null;
    const airports = me
      .units(UnitType.Airport)
      .filter(
        (a) =>
          !a.isUnderConstruction() &&
          a.markedForDeletion() === false &&
          this.game.manhattanDist(a.tile(), this.clickedTile) <= 5,
      );
    const home = findClosestBy(airports, (a) =>
      this.game.manhattanDist(a.tile(), this.clickedTile),
    );
    if (!home) return null;
    const stationed = me
      .units(UnitType.Fighter)
      .filter((f) => f.targetUnitId() === home.id()).length;
    return stationed < home.level() ? home.tile() : null;
  }

  private canBuildFighter(bu: BuildableUnit): boolean {
    const me = this.game?.myPlayer();
    if (!me || me.gold() < bu.cost) return false;
    if (missingTech(this.game.config(), me, UnitType.Fighter) !== null) {
      return false;
    }
    return this.fighterHome() !== null;
  }

  public sendBuildOrUpgrade(buildableUnit: BuildableUnit, tile: TileRef): void {
    if (buildableUnit.type === UnitType.Fighter) {
      const home = this.fighterHome();
      if (home !== null && this.canBuildFighter(buildableUnit)) {
        this.eventBus.emit(new BuildUnitIntentEvent(UnitType.Fighter, home));
      }
      this.hideMenu();
      return;
    }
    if (buildableUnit.canUpgrade !== false) {
      this.eventBus.emit(
        new SendUpgradeStructureIntentEvent(
          buildableUnit.canUpgrade,
          buildableUnit.type,
        ),
      );
    } else if (buildableUnit.canBuild) {
      const rocketDirectionUp =
        buildableUnit.type === UnitType.AtomBomb ||
        buildableUnit.type === UnitType.HydrogenBomb
          ? this.uiState.rocketDirectionUp
          : undefined;
      this.eventBus.emit(
        new BuildUnitIntentEvent(buildableUnit.type, tile, rocketDirectionUp),
      );
    }
    this.hideMenu();
  }

  render() {
    return html`
      <div
        class="build-menu ${this._hidden ? "hidden" : ""}"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        ${this.filteredBuildTable.map(
          (row) => html`
            <div class="build-row">
              ${row.map((item) => {
                const buildableUnit = this.playerBuildables?.find(
                  (bu) => bu.type === item.unitType,
                );
                if (buildableUnit === undefined) {
                  return html``;
                }
                // GalloFront: a unit behind a technology says which one and
                // taps through to the technologies panel instead of sitting
                // greyed out with a cost nobody can pay yet.
                const locked = missingTech(
                  this.game?.config(),
                  this.game?.myPlayer(),
                  item.unitType,
                );
                if (locked !== null) {
                  return html`
                    <button
                      class="build-button locked"
                      @click=${() => this.openTechPanel(locked)}
                      title=${translateText("build_menu.requires_tech_tap")}
                    >
                      <img
                        src=${item.icon}
                        alt="${item.unitType}"
                        width="40"
                        height="40"
                      />
                      <span class="build-name">
                        ${item.key && translateText(item.key)}
                      </span>
                      <span class="build-lock"
                        >${requiresTechLabel(locked)}</span
                      >
                    </button>
                  `;
                }
                const enabled =
                  item.unitType === UnitType.Fighter
                    ? this.canBuildFighter(buildableUnit)
                    : buildableUnit.canBuild !== false ||
                      buildableUnit.canUpgrade !== false;
                return html`
                  <button
                    class="build-button"
                    @click=${() =>
                      this.sendBuildOrUpgrade(buildableUnit, this.clickedTile)}
                    ?disabled=${!enabled}
                    title=${!enabled
                      ? translateText("build_menu.not_enough_money")
                      : ""}
                  >
                    <img
                      src=${item.icon}
                      alt="${item.unitType}"
                      width="40"
                      height="40"
                    />
                    <span class="build-name">
                      ${item.key && translateText(item.key)}
                    </span>
                    <span class="build-description"
                      >${item.description &&
                      translateText(item.description)}</span
                    >
                    <span class="build-cost" translate="no">
                      ${renderNumber(
                        this.game && this.game.myPlayer() ? this.cost(item) : 0,
                      )}
                      <img
                        src=${goldCoinIcon}
                        alt="gold"
                        width="12"
                        height="12"
                        class="align-middle"
                      />
                    </span>
                    ${item.countable
                      ? html`<div class="build-count-chip">
                          <span class="build-count">${this.count(item)}</span>
                        </div>`
                      : ""}
                  </button>
                `;
              })}
            </div>
          `,
        )}
      </div>
    `;
  }

  hideMenu() {
    this._hidden = true;
    this.requestUpdate();
  }

  /** A locked item was tapped: close and open Technologies on its tech. */
  private openTechPanel(tech: TechId) {
    this.hideMenu();
    this.eventBus?.emit(new ShowTechPanelEvent(true, tech));
  }

  showMenu(clickedTile: TileRef) {
    this.clickedTile = clickedTile;
    this._hidden = false;
    this.refresh();
  }

  private refresh() {
    this.game
      .myPlayer()
      ?.buildables(this.clickedTile, BuildMenus.types)
      .then((buildables) => {
        this.playerBuildables = buildables;
        this.requestUpdate();
      });

    // remove disabled buildings from the buildtable
    this.filteredBuildTable = this.getBuildableUnits();
  }

  private getBuildableUnits(): BuildItemDisplay[][] {
    return buildTable.map((row) =>
      row.filter((item) => !this.game?.config()?.isUnitDisabled(item.unitType)),
    );
  }

  get isVisible() {
    return !this._hidden;
  }
}
