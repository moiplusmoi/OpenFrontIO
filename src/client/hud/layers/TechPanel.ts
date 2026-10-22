import {
  TECH_TREE,
  TechBranch,
  TechDef,
  TechId,
} from "@openfront/engine-api/game/GameTypes";
import { renderNumber } from "@openfront/engine-lib/Format";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { CloseViewEvent, ToggleTechPanelEvent } from "../../InputHandler";
import { SendResearchIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";
import { unitsUnlockedBy, unitTypeKey } from "./TechLock";

import "../../components/ui/Icon";
import type { IconName } from "../../components/ui/Icon";
import { ShowTechPanelEvent } from "./TechPanelEvents";

// Re-exported so existing imports (GameRightSidebar, tests) keep working.
export { ShowTechPanelEvent };

const BRANCHES: readonly { branch: TechBranch; key: string; icon: IconName }[] =
  [
    { branch: TechBranch.Economy, key: "economy", icon: "coins" },
    { branch: TechBranch.Military, key: "military", icon: "crossed" },
    { branch: TechBranch.Defense, key: "defense", icon: "shield" },
  ];

type TechStatus = "done" | "researching" | "available" | "locked";

/** How long the card a locked item sent us to keeps its ring. */
const HIGHLIGHT_MS = 4000;

/**
 * GalloFront: the technologies panel. A 3 (branches) × 4 (levels) grid of
 * techs the local player can research, one at a time. Full screen under
 * `lg`, a centered card above it.
 */
@customElement("tech-panel")
export class TechPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state() private isVisible = false;
  /** Bumped each tick while open so the progress bar and gold refresh. */
  @state() private tickCount = 0;
  /** The tech a locked build item sent us to; flashed and scrolled into view. */
  @state() private highlight: TechId | null = null;
  private highlightTimer: number | undefined;

  createRenderRoot() {
    return this; // Light DOM so Tailwind applies.
  }

  init() {
    this.eventBus.on(ShowTechPanelEvent, (e) =>
      e.visible ? this.open(e.highlight) : this.close(),
    );
    this.eventBus.on(ToggleTechPanelEvent, () =>
      this.isVisible ? this.close() : this.open(),
    );
    this.eventBus.on(CloseViewEvent, () => {
      if (this.isVisible) this.close();
    });
  }

  tick() {
    if (this.isVisible) this.tickCount = this.game.ticks();
  }

  open(highlight: TechId | null = null) {
    this.isVisible = true;
    window.clearTimeout(this.highlightTimer);
    this.highlight = highlight;
    if (highlight !== null) {
      this.highlightTimer = window.setTimeout(() => {
        this.highlight = null;
      }, HIGHLIGHT_MS);
    }
  }

  close() {
    this.isVisible = false;
    window.clearTimeout(this.highlightTimer);
    this.highlight = null;
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    if (!changed.has("highlight") || this.highlight === null) return;
    // Lit has committed the DOM; bring the highlighted card into view.
    const card = this.querySelector(`[data-tech="${this.highlight}"]`);
    if (
      card instanceof HTMLElement &&
      typeof card.scrollIntoView === "function"
    ) {
      card.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  private onBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) this.close();
  };

  private onResearchClick(tech: TechId) {
    this.eventBus.emit(new SendResearchIntentEvent(tech));
  }

  private status(player: PlayerView | null, def: TechDef): TechStatus {
    if (player === null) return "locked";
    if (player.hasTech(def.id)) return "done";
    if (player.research()?.tech === def.id) return "researching";
    if (def.requires !== null && !player.hasTech(def.requires)) return "locked";
    return "available";
  }

  render() {
    if (!this.isVisible || this.game === undefined) return nothing;
    const player = this.game.myPlayer();
    const research = player?.research() ?? null;
    const gold = player?.gold() ?? 0n;

    return html`
      <div
        class="fixed inset-0 z-10002 flex items-center justify-center bg-black/60 backdrop-blur-sm lg:p-6"
        @click=${this.onBackdropClick}
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
        @wheel=${(e: WheelEvent) => e.stopPropagation()}
      >
        <div
          class="flex h-full w-full flex-col overflow-hidden bg-zinc-900/95 text-white shadow-2xl ring-1 ring-white/10
                 lg:h-auto lg:max-h-[90vh] lg:w-auto lg:max-w-5xl lg:rounded-2xl"
          role="dialog"
          aria-modal="true"
          aria-label=${translateText("tech_panel.title")}
        >
          <header
            class="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3"
          >
            <div class="flex items-center gap-2">
              <of-icon name="flask" size="24" class="text-blue-300"></of-icon>
              <h2 class="text-lg font-bold">
                ${translateText("tech_panel.title")}
              </h2>
            </div>
            <div class="flex items-center gap-3">
              <span
                translate="no"
                class="rounded-lg bg-white/5 px-3 py-1.5 text-sm tabular-nums"
                title=${translateText("player_panel.gold")}
              >
                <of-icon name="coins" size="14" class="mr-1"></of-icon
                >${renderNumber(gold)}
              </span>
              <button
                class="flex size-11 items-center justify-center rounded-full bg-zinc-700 text-lg hover:bg-red-500 transition-colors"
                aria-label=${translateText("common.close")}
                @click=${this.close}
              >
                <of-icon name="close" size="18"></of-icon>
              </button>
            </div>
          </header>

          <div
            class="grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 md:grid-cols-3"
          >
            ${BRANCHES.map((b) => this.renderBranch(b, player, research, gold))}
          </div>
        </div>
      </div>
    `;
  }

  private renderBranch(
    b: (typeof BRANCHES)[number],
    player: PlayerView | null,
    research: ReturnType<PlayerView["research"]>,
    gold: bigint,
  ) {
    const defs = TECH_TREE.filter((t) => t.branch === b.branch);
    return html`
      <section class="flex flex-col gap-2">
        <h3
          class="flex items-center gap-2 px-1 text-sm font-semibold uppercase tracking-wider text-zinc-300"
        >
          <of-icon name=${b.icon} size="16"></of-icon>
          ${translateText(`tech_panel.branch.${b.key}`)}
        </h3>
        ${defs.map((def) => this.renderTech(def, player, research, gold))}
      </section>
    `;
  }

  private renderTech(
    def: TechDef,
    player: PlayerView | null,
    research: ReturnType<PlayerView["research"]>,
    gold: bigint,
  ) {
    const status = this.status(player, def);
    const config = this.game.config();
    const cost = config.techCost(def.id);
    const seconds = Math.round(config.techDuration(def.id) / 10);
    const canAfford = gold >= cost;
    const canResearch =
      status === "available" && canAfford && research === null;

    let box = "border-white/10 bg-white/5";
    if (status === "done") box = "border-green-500/60 bg-green-500/10";
    else if (status === "researching")
      box = "border-blue-400/60 bg-blue-500/10";
    else if (status === "locked") box = "border-white/5 bg-white/2 opacity-50";
    const ring =
      this.highlight === def.id
        ? "ring-2 ring-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.6)] !opacity-100"
        : "";
    const unlocks = unitsUnlockedBy(config, def.id);

    return html`
      <article
        class="flex flex-col gap-1.5 rounded-xl border p-3 ${box} ${ring}"
        data-tech=${def.id}
        data-status=${status}
      >
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-base font-semibold">
            ${translateText(`tech.${def.id}.name`)}
          </span>
          <span class="text-xs text-zinc-400 tabular-nums">
            ${translateText("tech_panel.level", { level: def.level })}
          </span>
        </div>
        <p class="line-clamp-2 min-h-[2.5rem] text-sm leading-5 text-zinc-300">
          ${translateText(`tech.${def.id}.desc`)}
        </p>
        ${unlocks.length > 0
          ? html`<p class="text-xs leading-4 text-amber-200/90">
              <of-icon name="unlock" size="12" class="mr-1"></of-icon>
              ${translateText("tech_panel.unlocks", {
                units: unlocks
                  .map((unit) => translateText(unitTypeKey(unit)))
                  .join(", "),
              })}
            </p>`
          : nothing}
        <div
          class="flex items-center justify-between gap-2 text-sm tabular-nums"
          translate="no"
        >
          <span class=${status !== "done" && !canAfford ? "text-red-300" : ""}>
            <span class="inline-flex items-center gap-1"
              ><of-icon name="coins" size="14"></of-icon>${renderNumber(
                cost,
              )}</span
            >
          </span>
          <span class="text-zinc-400">
            <span class="inline-flex items-center gap-1"
              ><of-icon name="hourglass" size="14"></of-icon>${translateText(
                "tech_panel.duration",
                { seconds },
              )}</span
            >
          </span>
        </div>
        ${this.renderAction(def, status, canResearch, research)}
      </article>
    `;
  }

  private renderAction(
    def: TechDef,
    status: TechStatus,
    canResearch: boolean,
    research: ReturnType<PlayerView["research"]>,
  ) {
    switch (status) {
      case "done":
        return html`<div
          class="flex min-h-11 items-center justify-center rounded-lg bg-green-600/30 text-sm font-semibold text-green-200"
        >
          <of-icon name="check" size="16" class="mr-1"></of-icon
          >${translateText("tech_panel.done")}
        </div>`;
      case "researching": {
        const start = research?.startTick ?? 0;
        const end = research?.endTick ?? start + 1;
        const ticks = this.game.ticks();
        const progress = Math.min(
          1,
          Math.max(0, (ticks - start) / Math.max(1, end - start)),
        );
        const left = Math.max(0, Math.ceil((end - ticks) / 10));
        return html`<div class="flex min-h-11 flex-col justify-center gap-1">
          <div class="flex justify-between text-xs text-blue-200">
            <span>${translateText("tech_panel.researching")}</span>
            <span translate="no"
              >${translateText("tech_panel.duration", { seconds: left })}</span
            >
          </div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              class="h-full rounded-full bg-blue-400 transition-[width] duration-100"
              style="width: ${Math.round(progress * 100)}%"
            ></div>
          </div>
        </div>`;
      }
      case "locked":
        return html`<div
          class="flex min-h-11 items-center justify-center rounded-lg bg-white/5 text-sm text-zinc-400"
        >
          <of-icon name="lock" size="14" class="mr-1"></of-icon>${translateText(
            "tech_panel.requires",
            { level: def.level - 1 },
          )}
        </div>`;
      case "available":
        return html`<button
          class="min-h-11 w-full rounded-lg text-sm font-semibold transition-colors
                 ${canResearch
            ? "bg-blue-600 hover:bg-blue-500 active:bg-blue-700"
            : "cursor-not-allowed bg-white/10 text-zinc-400"}"
          ?disabled=${!canResearch}
          @click=${() => this.onResearchClick(def.id)}
        >
          <of-icon name="flask" size="16" class="mr-1"></of-icon
          >${translateText("tech_panel.research")}
        </button>`;
    }
  }
}
