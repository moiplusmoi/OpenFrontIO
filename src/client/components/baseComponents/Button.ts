import { LitElement, TemplateResult, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../Utils";

type ButtonVariant = "primary" | "secondary" | "danger" | "warning" | "ghost";
type ButtonSize = "xs" | "sm" | "md" | "lg";
type ButtonWidth = "auto" | "block" | "blockDesktop" | "fill";
type IconPosition = "left" | "right" | "only";

@customElement("o-button")
export class OButton extends LitElement {
  @property() title = "";
  @property() translationKey = "";
  @property() variant: ButtonVariant = "primary";
  @property() size: ButtonSize = "md";
  @property() width: ButtonWidth = "auto";
  @property() iconPosition: IconPosition = "left";
  @property({ attribute: false }) icon?: TemplateResult;
  @property({ type: Boolean }) disable = false;
  @property({ type: Boolean }) submit = false;
  @property({ type: Boolean }) uppercase = false;

  createRenderRoot() {
    return this;
  }

  // Quiet and consistent: a fixed radius, semibold sentence-case labels, colour
  // changes instead of bounces. Focus comes from the global :focus-visible ring.
  private readonly BASE =
    "font-semibold tracking-normal rounded-lg border border-transparent " +
    "transition-colors duration-150 " +
    "outline-none text-center whitespace-normal break-words leading-tight overflow-hidden relative " +
    "disabled:cursor-not-allowed disabled:opacity-60";

  private variantClasses(): string {
    switch (this.variant) {
      case "primary":
        return "bg-malibu-blue hover:bg-bright-blue active:bg-malibu-blue text-white shadow-sm disabled:bg-hud-raised disabled:text-ink-faint disabled:shadow-none";
      case "secondary":
        return "bg-hud-raised border-hud-line-strong hover:bg-hud text-ink disabled:text-ink-faint";
      case "danger":
        return "bg-red-600 hover:bg-red-500 text-white disabled:bg-hud-raised disabled:text-ink-faint";
      case "warning":
        return "bg-cyber-yellow hover:brightness-95 text-gray-900 disabled:bg-hud-raised disabled:text-ink-faint";
      case "ghost":
        return "bg-transparent hover:bg-white/5 text-aquarius disabled:text-ink-faint disabled:hover:bg-transparent";
    }
  }

  private sizeClasses(): string {
    if (this.iconPosition === "only") {
      switch (this.size) {
        case "xs":
          return "w-6 h-6 text-xs";
        case "sm":
          return "w-8 h-8 text-sm";
        case "md":
          return "w-10 h-10 text-base";
        case "lg":
          return "w-12 h-12 text-lg";
      }
    }
    switch (this.size) {
      case "xs":
        return "py-1 px-2 text-xs";
      case "sm":
        return "py-1.5 px-3 text-sm";
      case "md":
        return "py-3 px-4 text-base lg:text-lg";
      case "lg":
        return "py-4 px-6 text-lg lg:text-xl";
    }
  }

  private widthClasses(): string {
    switch (this.width) {
      case "auto":
        return "inline-flex items-center justify-center gap-2";
      case "block":
        return "flex w-full items-center justify-center gap-2";
      case "blockDesktop":
        return "flex w-full items-center justify-center gap-2 lg:w-1/2 lg:mx-auto";
      case "fill":
        return "flex w-full h-full items-center justify-center gap-2";
    }
  }

  render() {
    const label =
      this.translationKey === ""
        ? this.title
        : translateText(this.translationKey);
    const iconOnly = this.iconPosition === "only";
    const casing = this.uppercase ? "uppercase" : "normal-case";
    const classes = `${this.BASE} ${casing} ${this.variantClasses()} ${this.sizeClasses()} ${this.widthClasses()}`;

    return html`
      <button
        class=${classes}
        ?disabled=${this.disable}
        type=${this.submit ? "submit" : "button"}
        aria-label=${iconOnly ? label : nothing}
      >
        ${this.icon && this.iconPosition !== "right" ? this.icon : nothing}
        ${iconOnly ? nothing : html`<span class="min-w-0">${label}</span>`}
        ${this.icon && this.iconPosition === "right" ? this.icon : nothing}
      </button>
    `;
  }
}
