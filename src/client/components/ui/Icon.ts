import { html, LitElement } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { customElement, property } from "lit/decorators.js";

/**
 * Line icons on a 24 grid, drawn with `currentColor` so they follow the text
 * color of the surrounding element. Used instead of emoji, which render
 * differently on every OS and clash with the rest of the interface.
 */
const ICONS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" />',
  close: '<path d="M6 6l12 12M18 6L6 18" />',
  coins:
    '<path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z" /><path d="M4 7v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7" /><path d="M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5" />',
  crossed:
    '<path d="M5 19L19 5M5 5l14 14" /><path d="M3.5 7.5l3-3M17.5 21.5l3-3" />',
  crown: '<path d="M3 8l4.5 4L12 6l4.5 6L21 8l-2 11H5z" />',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />',
  flask:
    '<path d="M9.5 3h5M10.5 3v5.5L5.5 17a2.5 2.5 0 0 0 2.2 3.7h8.6a2.5 2.5 0 0 0 2.2-3.7L13.5 8.5V3" />',
  gear: '<circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />',
  hourglass:
    '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9" />',
  lock: '<rect x="6" y="11" width="12" height="9" rx="1.5" /><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />',
  alert:
    '<path d="M12 3.5L2.5 20h19L12 3.5Z" /><path d="M12 10v4M12 17h.01" />',
  parachute:
    '<path d="M3 12a9 9 0 0 1 18 0c-2 1-3 1-4.5 0-1.5 1-3 1-4.5 0-1.5 1-3 1-4.5 0-1.5 1-2.5 1-4.5 0Z" /><path d="M9 12l3 8 3-8" />',
  shield: '<path d="M12 3L5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z" />',
  spy: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />',
  star: '<path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 17.2 6.7 20l1.1-6-4.4-4.2 6-.8Z" />',
  plane:
    '<path d="M10.5 3.5h3L14 9l6 3.5v2l-6-1.5-.5 4.5 2 1.5V21L12 20.2 9.5 21v-1.5l2-1.5-.5-4.5-6 1.5v-2L10 9l.5-5.5Z" />',
  target:
    '<circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.5" />',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14M5 19l7-7" />',
  snowflake: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />',
  sprout:
    '<path d="M12 21v-9M12 12c0-4 3-6 7-6 0 4-3 6-7 6ZM12 15c0-3-2-5-6-5 0 3 2 5 6 5Z" />',
  sun: '<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />',
  swap: '<path d="M7 4v14M3.5 14.5L7 18l3.5-3.5M17 20V6M13.5 9.5L17 6l3.5 3.5" />',
  unlock:
    '<rect x="6" y="11" width="12" height="9" rx="1.5" /><path d="M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2" />',
  city: '<path d="M3 21V9h6v12M9 21V4h12v17M13 8h2M13 12h2M13 16h2M3 21h18" />',
} as const;

export type IconName = keyof typeof ICONS;

/**
 * Inline SVG icon: `<of-icon name="shield" size="16">`. Decorative by default
 * (aria-hidden); the label should live in the surrounding text or a button's
 * aria-label.
 */
@customElement("of-icon")
export class OfIcon extends LitElement {
  @property({ type: String })
  name: IconName = "check";

  @property({ type: Number })
  size = 16;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width=${this.size}
      height=${this.size}
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class="inline-block shrink-0 align-[-0.125em]"
    >
      ${unsafeSVG(ICONS[this.name])}
    </svg>`;
  }
}
