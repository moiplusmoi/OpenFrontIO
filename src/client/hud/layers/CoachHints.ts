import {
  TECH_TREE,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import "../../components/ui/Icon";
import type { IconName } from "../../components/ui/Icon";
import { UserSettings } from "../../UserSettings";
import { textDirection, translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";
import { ShowTechPanelEvent } from "./TechPanelEvents";

/** How long a hint stays up before it goes by itself. */
const HINT_MS = 8000;
/** How often the game state is checked. */
const POLL_MS = 500;
/** Gold thresholds for the "build a city" / "start a research" hints. */
const CITY_GOLD = 125_000n;
const RESEARCH_GOLD = 250_000n;
/** localStorage key of a hint already shown (never shown again). */
const STORAGE_PREFIX = "gallofront.hints.";

type HintId =
  | "spawn_done"
  | "first_city"
  | "first_research"
  | "airport"
  | "bomber"
  | "spy"
  | "attacked";

interface Hint {
  id: HintId;
  icon: IconName;
  /** The tech to open the panel on when the hint is tapped (if any). */
  tech?: TechId | null;
  /** Fires once the condition holds; the hint is then shown and remembered. */
  when: (game: GameView, player: PlayerView) => boolean;
}

function unitTech(game: GameView, unit: UnitType): TechId | null {
  const config = game.config();
  return typeof config.unitRequiredTech === "function"
    ? config.unitRequiredTech(unit)
    : null;
}

/** Order matters: the first due hint wins the slot. */
const HINTS: readonly Hint[] = [
  {
    id: "attacked",
    icon: "shield",
    when: (_, p) => p.incomingAttacks().length > 0,
  },
  {
    id: "spawn_done",
    icon: "crossed",
    when: (g) => !g.inSpawnPhase(),
  },
  {
    id: "first_city",
    icon: "city",
    when: (_, p) =>
      p.gold() >= CITY_GOLD && p.units(UnitType.City).length === 0,
  },
  {
    id: "first_research",
    icon: "flask",
    tech: TechId.Eco1,
    when: (_, p) =>
      p.gold() >= RESEARCH_GOLD &&
      p.research() === null &&
      !TECH_TREE.some((t) => p.hasTech(t.id)),
  },
  {
    id: "airport",
    icon: "plane",
    when: (g, p) => {
      const tech = unitTech(g, UnitType.Airport);
      return tech !== null && p.hasTech(tech);
    },
  },
  {
    id: "bomber",
    icon: "target",
    when: (g, p) => {
      const tech = unitTech(g, UnitType.Bomber);
      return tech !== null && p.hasTech(tech);
    },
  },
  {
    id: "spy",
    icon: "spy",
    when: (g, p) => {
      const tech = unitTech(g, UnitType.Spy);
      return tech !== null && p.hasTech(tech);
    },
  },
];

/**
 * GalloFront: one-shot coaching hints for a first game. Each hint shows
 * once ever (localStorage), one at a time for HINT_MS, with a ✕ to drop it;
 * the in-game settings can switch them off. Quiet while the in-game
 * tutorial is running — it already guides the player.
 *
 * Wired by GameRenderer like any Controller (game, eventBus, init, tick).
 * Until it is, it also wires itself: once a game is on, it adopts the game
 * and bus from the already-wired <tech-panel> and polls on its own clock.
 */
@customElement("coach-hints")
export class CoachHints extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public userSettings: UserSettings = new UserSettings();

  @state() private current: Hint | null = null;
  private hideTimer: number | undefined;
  private lastCheck = 0;
  private seen = new Set<HintId>();
  /** The game this instance was prepared for, to reset on a new one. */
  private preparedFor: GameView | null = null;
  /** Set by GameRenderer's init(); the self-poll then stays passive. */
  private wiredByRenderer = false;
  private selfPoll: number | undefined;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.style.display = "none";
    this.selfPoll = window.setInterval(() => this.selfWire(), POLL_MS);
  }

  disconnectedCallback() {
    window.clearInterval(this.selfPoll);
    window.clearTimeout(this.hideTimer);
    super.disconnectedCallback();
  }

  init() {
    this.wiredByRenderer = true;
    this.prepare();
  }

  getTickIntervalMs() {
    return POLL_MS;
  }

  tick() {
    this.check();
  }

  /** Fallback wiring when GameRenderer does not know this element yet. */
  private selfWire() {
    if (this.wiredByRenderer) return;
    if (!document.body.classList.contains("in-game")) return;
    const panel = document.querySelector("tech-panel") as
      | (HTMLElement & { game?: GameView; eventBus?: EventBus })
      | null;
    if (!panel?.game || !panel.eventBus) return;
    if (panel.game !== this.game) {
      this.game = panel.game;
      this.eventBus = panel.eventBus;
      this.prepare();
    }
    this.check();
  }

  private prepare() {
    if (this.preparedFor === this.game) return;
    this.preparedFor = this.game;
    this.seen = new Set(
      HINTS.filter((h) => this.remembered(h.id)).map((h) => h.id),
    );
    this.dismiss(false);
  }

  private remembered(id: HintId): boolean {
    try {
      return localStorage.getItem(STORAGE_PREFIX + id) !== null;
    } catch {
      return true;
    }
  }

  private remember(id: HintId) {
    try {
      localStorage.setItem(STORAGE_PREFIX + id, "1");
    } catch {
      // No storage: the hint may show again next game; nothing to do.
    }
  }

  private check() {
    const now = Date.now();
    if (now - this.lastCheck < POLL_MS) return;
    this.lastCheck = now;
    if (this.current !== null || this.game === undefined) return;
    if (!this.userSettings.coachHints()) return;
    // The in-game tutorial is on: it already guides the player.
    if (!this.userSettings.tutorialDismissed()) return;
    const config = this.game.config();
    if (typeof config.isReplay === "function" && config.isReplay()) return;
    if (this.game.isCatchingUp()) return;
    const player = this.game.myPlayer();
    if (player === null || !player.hasSpawned() || !player.isAlive()) return;

    for (const hint of HINTS) {
      if (this.seen.has(hint.id)) continue;
      let due: boolean;
      try {
        due = hint.when(this.game, player);
      } catch {
        due = false;
      }
      if (!due) continue;
      this.seen.add(hint.id);
      this.remember(hint.id);
      this.show(hint);
      return;
    }
  }

  private show(hint: Hint) {
    this.current = hint;
    this.style.display = "block";
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.dismiss(), HINT_MS);
  }

  private dismiss(rerender = true) {
    window.clearTimeout(this.hideTimer);
    this.current = null;
    this.style.display = "none";
    if (rerender) this.requestUpdate();
  }

  private onBodyClick = () => {
    const tech = this.current?.tech;
    if (tech !== undefined && tech !== null && this.eventBus) {
      this.eventBus.emit(new ShowTechPanelEvent(true, tech));
    }
    this.dismiss();
  };

  render() {
    const hint = this.current;
    if (hint === null) return nothing;
    return html`
      <div
        dir=${textDirection()}
        role="status"
        class="pointer-events-auto w-full sm:rounded-lg bg-gray-800/92 backdrop-blur-sm shadow-lg text-white p-2 sm:mb-1 flex items-start gap-2"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <span class="text-xl leading-6 shrink-0" aria-hidden="true"
          ><of-icon name=${hint.icon} size="16"></of-icon
        ></span>
        <button
          class="flex-1 text-left text-sm leading-5 min-w-0"
          @click=${this.onBodyClick}
        >
          <span
            class="block font-bold text-cyber-yellow uppercase tracking-wide text-xs"
            >${translateText("coach.title")}</span
          >
          ${translateText(`coach.hint.${hint.id}`)}
        </button>
        <button
          class="shrink-0 size-8 -m-1 flex items-center justify-center rounded text-gray-400 hover:text-white text-base leading-none"
          title=${translateText("coach.close")}
          aria-label=${translateText("coach.close")}
          @click=${() => this.dismiss()}
        >
          <of-icon name="close" size="14"></of-icon>
        </button>
      </div>
    `;
  }
}
