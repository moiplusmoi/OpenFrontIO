import {
  ResourceType,
  RESOURCE_TYPES,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { CloseViewEvent } from "../../InputHandler";
import { SendConvoyIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { GameView, UnitView } from "../../view";
import { ShowConvoyPanelEvent } from "./ConvoyPanelEvents";
import { unitTypeKey } from "./TechLock";

type Mode = "rail" | "sea" | "air";

const RESOURCE_KEY: Record<ResourceType, string> = {
  [ResourceType.Oil]: "convoy.oil",
  [ResourceType.Metal]: "convoy.metal",
  [ResourceType.Food]: "convoy.food",
};

/** The route a pair of structures can take, by what they are. */
function defaultMode(src: UnitView, dst: UnitView): Mode {
  if (src.type() === UnitType.Port && dst.type() === UnitType.Port)
    return "sea";
  if (src.type() === UnitType.Airport && dst.type() === UnitType.Airport) {
    return "air";
  }
  return "rail";
}

/**
 * GalloFront: the convoy panel. Pick a structure you own, a destination you
 * own, a resource, an amount and a route; the engine checks the route and
 * sends the convoy. Rails need stations on both ends, sea needs ports on the
 * same sea, air needs airports.
 */
@customElement("convoy-panel")
export class ConvoyPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state() private isVisible = false;
  @state() private sourceId: number | null = null;
  @state() private destinationId: number | null = null;
  @state() private resource: ResourceType = ResourceType.Food;
  @state() private amount = 20;
  @state() private mode: Mode = "rail";

  createRenderRoot() {
    return this; // Light DOM so Tailwind applies.
  }

  init() {
    this.eventBus.on(ShowConvoyPanelEvent, (e) =>
      e.sourceId === null ? this.close() : this.open(e.sourceId),
    );
    this.eventBus.on(CloseViewEvent, () => {
      if (this.isVisible) this.close();
    });
  }

  tick() {
    if (this.isVisible) this.requestUpdate();
  }

  open(sourceId: number) {
    this.sourceId = sourceId;
    this.destinationId = null;
    this.isVisible = true;
    this.resource = ResourceType.Food;
    this.amount = 20;
  }

  close() {
    this.isVisible = false;
    this.sourceId = null;
    this.destinationId = null;
  }

  /** My structures other than the source: the places a convoy can go. */
  private destinations(src: UnitView): UnitView[] {
    const me = this.game.myPlayer();
    if (me === null) return [];
    return me
      .units()
      .filter(
        (u) =>
          u.id() !== src.id() &&
          !u.isUnderConstruction() &&
          Structures.has(u.type()),
      );
  }

  private send(src: UnitView, dst: UnitView) {
    this.eventBus.emit(
      new SendConvoyIntentEvent(
        src.id(),
        dst.id(),
        this.resource,
        this.amount,
        this.mode,
      ),
    );
    this.close();
  }

  render() {
    if (!this.isVisible || this.game === undefined || this.sourceId === null) {
      return nothing;
    }
    const src = this.game.unit(this.sourceId);
    if (src === undefined) return nothing;
    const dsts = this.destinations(src);
    const dst =
      this.destinationId === null
        ? undefined
        : dsts.find((u) => u.id() === this.destinationId);
    const stock = src.stock(this.resource);
    const amountOk = this.amount > 0 && this.amount <= stock;
    const canSend = dst !== undefined && amountOk;

    return html`
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.close();
        }}
      >
        <div
          class="w-full max-w-md rounded-xl bg-[#0a1628] p-5 text-white shadow-xl"
        >
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-lg font-semibold">
              ${translateText("convoy.title")}
            </h2>
            <button
              class="text-white/70 hover:text-white"
              @click=${() => this.close()}
            >
              ✕
            </button>
          </div>

          <label class="mb-3 block text-sm">
            ${translateText("convoy.resource")}
            <select
              class="mt-1 w-full rounded bg-[#132338] p-2"
              @change=${(e: Event) => {
                this.resource = (e.target as HTMLSelectElement)
                  .value as ResourceType;
                this.amount = Math.min(this.amount, src.stock(this.resource));
              }}
            >
              ${RESOURCE_TYPES.map(
                (r) => html`<option value=${r} ?selected=${r === this.resource}>
                  ${translateText(RESOURCE_KEY[r])} (${src.stock(r)})
                </option>`,
              )}
            </select>
          </label>

          <label class="mb-3 block text-sm">
            ${translateText("convoy.amount")}
            <input
              type="number"
              min="1"
              max=${stock}
              .value=${String(this.amount)}
              class="mt-1 w-full rounded bg-[#132338] p-2"
              @input=${(e: Event) => {
                this.amount = Number((e.target as HTMLInputElement).value);
              }}
            />
          </label>

          <label class="mb-3 block text-sm">
            ${translateText("convoy.to")}
            <select
              class="mt-1 w-full rounded bg-[#132338] p-2"
              @change=${(e: Event) => {
                const id = Number((e.target as HTMLSelectElement).value);
                this.destinationId = Number.isNaN(id) ? null : id;
                const target = dsts.find((u) => u.id() === id);
                if (target !== undefined) this.mode = defaultMode(src, target);
              }}
            >
              <option value="">${translateText("convoy.choose")}</option>
              ${dsts.map(
                (u) => html`<option
                  value=${u.id()}
                  ?selected=${u.id() === this.destinationId}
                >
                  ${translateText(unitTypeKey(u.type()))} #${u.id()}
                </option>`,
              )}
            </select>
          </label>

          <label class="mb-4 block text-sm">
            ${translateText("convoy.mode")}
            <select
              class="mt-1 w-full rounded bg-[#132338] p-2"
              @change=${(e: Event) => {
                this.mode = (e.target as HTMLSelectElement).value as Mode;
              }}
            >
              <option value="rail" ?selected=${this.mode === "rail"}>
                ${translateText("convoy.mode_rail")}
              </option>
              <option value="sea" ?selected=${this.mode === "sea"}>
                ${translateText("convoy.mode_sea")}
              </option>
              <option value="air" ?selected=${this.mode === "air"}>
                ${translateText("convoy.mode_air")}
              </option>
            </select>
          </label>

          <p class="mb-4 text-xs text-white/60">
            ${translateText("convoy.route_hint")}
          </p>

          <div class="flex justify-end gap-2">
            <button
              class="rounded px-4 py-2 text-sm text-white/80 hover:text-white"
              @click=${() => this.close()}
            >
              ${translateText("convoy.cancel")}
            </button>
            <button
              class="rounded bg-[#0084d1] px-4 py-2 text-sm font-semibold disabled:opacity-40"
              ?disabled=${!canSend}
              @click=${() => dst !== undefined && this.send(src, dst)}
            >
              ${translateText("convoy.send")}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
