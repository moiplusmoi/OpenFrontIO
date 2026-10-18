import {
  Season,
  seasonAt,
  seasonProgress,
  ticksToNextSeason,
} from "@openfront/engine-lib/game/Seasons";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { showToast, translateText } from "../../Utils";
import { GameView } from "../../view";

const SEASON_ICONS: Record<Season, string> = {
  [Season.Spring]: "🌱",
  [Season.Summer]: "☀️",
  [Season.Autumn]: "🍂",
  [Season.Winter]: "❄️",
};

// Tailwind text colors for the season name and progress bar.
const SEASON_COLORS: Record<Season, { text: string; bar: string }> = {
  [Season.Spring]: { text: "text-green-300", bar: "bg-green-400" },
  [Season.Summer]: { text: "text-yellow-300", bar: "bg-yellow-400" },
  [Season.Autumn]: { text: "text-orange-300", bar: "bg-orange-400" },
  [Season.Winter]: { text: "text-sky-300", bar: "bg-sky-400" },
};

const SEASON_CHANGED_TOAST_MS = 3000;

/**
 * GalloFront: the season readout, stacked under the right sidebar. The season
 * is a pure function of the tick (see engine-lib Seasons), so this reads it
 * straight off the game view each tick; nothing is sent over the wire. On a
 * season change it also fires the brief heads-up toast (client-side only).
 */
@customElement("season-display")
export class SeasonDisplay extends LitElement implements Controller {
  public game: GameView;

  @state() private season: Season = Season.Spring;
  @state() private progress = 0;
  @state() private secondsLeft = 0;
  @state() private enabled = false;

  // The season seen on the previous tick; null until the first tick, so the
  // initial season (and a late join / replay seek) never toasts.
  private lastSeason: Season | null = null;

  // Light DOM so Tailwind classes apply and it stacks in the parent's flex.
  createRenderRoot() {
    return this;
  }

  init() {
    this.enabled = this.game.config().seasonsEnabled();
    this.lastSeason = null;
    this.style.display = this.enabled ? "block" : "none";
    this.requestUpdate();
  }

  getTickIntervalMs() {
    return 250;
  }

  tick() {
    if (!this.enabled) return;
    const tick = this.game.ticks();
    const season = seasonAt(tick);
    this.progress = seasonProgress(tick);
    this.secondsLeft = Math.ceil(ticksToNextSeason(tick) / 10);

    if (season !== this.season || this.lastSeason === null) {
      // Only announce a live transition: not the first tick, and not while
      // the client is fast-forwarding through missed turns.
      if (
        this.lastSeason !== null &&
        season !== this.lastSeason &&
        !this.game.isCatchingUp()
      ) {
        showToast(
          translateText("season.changed", {
            season: translateText(`season.${season}`),
          }),
          "green",
          SEASON_CHANGED_TOAST_MS,
        );
      }
      this.season = season;
    }
    this.lastSeason = season;
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? `0${s}` : s}`;
  }

  render() {
    if (!this.enabled || this.game === undefined) return html``;
    const colors = SEASON_COLORS[this.season];
    const seasonName = translateText(`season.${this.season}`);
    const effect = translateText(`season.effect.${this.season}`);
    return html`
      <div
        data-season-display
        class="w-fit max-w-[60vw] sm:max-w-none flex flex-col gap-0.5 py-1 px-3 bg-gray-800/92 backdrop-blur-sm shadow-xs rounded-bl-lg text-white leading-tight"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div class="flex items-center justify-between gap-3 text-sm">
          <span class="font-bold ${colors.text}">
            <span aria-hidden="true">${SEASON_ICONS[this.season]}</span>
            ${seasonName}
          </span>
          <span
            class="text-gray-300 tabular-nums"
            title=${translateText("season.next", {
              time: this.formatTime(this.secondsLeft),
            })}
          >
            ${this.formatTime(this.secondsLeft)}
          </span>
        </div>
        <div
          class="relative h-0.5 w-full overflow-hidden rounded bg-gray-600/60"
        >
          <div
            class="absolute inset-y-0 left-0 ${colors.bar}"
            style="width:${Math.min(100, this.progress * 100)}%"
          ></div>
        </div>
        <div class="text-xs text-gray-300 truncate">${effect}</div>
      </div>
    `;
  }
}
