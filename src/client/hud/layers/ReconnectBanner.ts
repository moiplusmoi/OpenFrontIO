/**
 * GalloFront: a banner shown while the game socket is reconnecting, with a
 * "retry now" button that skips the backoff wait. Driven by two window events
 * from Transport: `transport-reconnect` (detail: {attempt, max} | null) and
 * the `transport-retry-now` request sent back on click.
 */
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../Utils";

type ReconnectState = { attempt: number; max: number } | null;

@customElement("reconnect-banner")
export class ReconnectBanner extends LitElement {
  @state() private reconnect: ReconnectState = null;

  // Tailwind classes come from the page stylesheet, not shadow CSS.
  createRenderRoot() {
    return this;
  }

  private readonly onReconnect = (e: Event) => {
    this.reconnect = (e as CustomEvent<ReconnectState>).detail ?? null;
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("transport-reconnect", this.onReconnect);
  }

  disconnectedCallback() {
    window.removeEventListener("transport-reconnect", this.onReconnect);
    super.disconnectedCallback();
  }

  render() {
    if (this.reconnect === null) return html``;
    const { attempt, max } = this.reconnect;
    return html`<div
      role="status"
      aria-live="polite"
      class="fixed top-2 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-3 px-3 py-2 rounded-lg bg-amber-900/95 border border-amber-400/60 text-amber-100 text-sm shadow-lg max-w-[92vw]"
    >
      <span>${translateText("reconnect_banner.text", { attempt, max })}</span>
      <button
        type="button"
        class="min-h-11 px-3 rounded border border-amber-300/70 bg-amber-300/10 hover:bg-amber-300/20 font-semibold whitespace-nowrap"
        @click=${() =>
          window.dispatchEvent(new CustomEvent("transport-retry-now"))}
      >
        ${translateText("reconnect_banner.retry")}
      </button>
    </div>`;
  }
}
