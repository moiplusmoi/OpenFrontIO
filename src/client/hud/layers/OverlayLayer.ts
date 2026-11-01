/**
 * OverlayLayer — GalloFront map overlay on a Canvas 2D layer over the WebGL map.
 *
 *  - Fortified blocks: a block held long enough to gain defence (see
 *    fortifyBonusPct) gets a faint amber hatch, stronger the more it is worth.
 *    Drawn only when zoomed in enough to read it, so it never clutters the
 *    overview.
 *  - Lot preview: while a structure is armed, small dots mark the tiles a
 *    right-click would build on (computed by BuildPreviewController).
 */

import { Cell } from "@openfront/engine-api/game/GameTypes";
import type { Controller } from "../../Controller";
import type { TransformHandler } from "../../TransformHandler";
import type { UIState } from "../../UIState";
import type { GameView } from "../../view";
import { DEFENSE_BLOCK_SIZE } from "../../view/DefenseBlocks";

/** Fortified blocks are drawn from this zoom on (screen pixels per tile). */
const FORT_MIN_SCALE = 0.8;
/** The bonus at which the hatch reaches full strength. */
const FORT_MAX_PCT = 40;
const PREVIEW_RADIUS_PX = 3;

export class OverlayLayer implements Controller {
  public uiState: UIState;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
    private mount: HTMLElement,
  ) {}

  init() {
    const canvas = document.createElement("canvas");
    canvas.id = "overlay-layer";
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    this.mount.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.frame();
  }

  private frame = () => {
    if (this.canvas === null || !this.canvas.isConnected) return;
    this.draw();
    requestAnimationFrame(this.frame);
  };

  private draw() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (canvas === null || ctx === null) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (this.transformHandler.scale >= FORT_MIN_SCALE) {
      this.drawFortified(ctx);
    }
    this.drawPreview(ctx);
  }

  private drawFortified(ctx: CanvasRenderingContext2D) {
    const th = this.transformHandler;
    const width = this.game.width();
    const height = this.game.height();
    for (let by = 0; by * DEFENSE_BLOCK_SIZE < height; by++) {
      for (let bx = 0; bx * DEFENSE_BLOCK_SIZE < width; bx++) {
        const x0 = bx * DEFENSE_BLOCK_SIZE;
        const y0 = by * DEFENSE_BLOCK_SIZE;
        const centre = this.game.ref(
          Math.min(width - 1, x0 + DEFENSE_BLOCK_SIZE / 2),
          Math.min(height - 1, y0 + DEFENSE_BLOCK_SIZE / 2),
        );
        const pct = this.game.fortifyPctAt(centre);
        if (pct === 0 || !this.game.owner(centre).isPlayer()) continue;

        const a = this.screenOf(x0, y0);
        const b = this.screenOf(
          Math.min(width, x0 + DEFENSE_BLOCK_SIZE),
          Math.min(height, y0 + DEFENSE_BLOCK_SIZE),
        );
        if (!th.isOnScreen(new Cell(x0, y0))) continue;

        const strength = Math.min(1, pct / FORT_MAX_PCT);
        ctx.fillStyle = `rgba(251, 191, 36, ${0.08 + 0.18 * strength})`;
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.strokeStyle = `rgba(251, 191, 36, ${0.3 + 0.4 * strength})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, b.y);
        ctx.lineTo(b.x, a.y);
        ctx.stroke();
      }
    }
  }

  private drawPreview(ctx: CanvasRenderingContext2D) {
    const tiles = this.uiState?.batchPreview ?? [];
    if (tiles.length === 0) return;
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.strokeStyle = "rgba(15, 23, 42, 0.8)";
    ctx.lineWidth = 1;
    for (const tile of tiles) {
      const p = this.screenOf(this.game.x(tile) + 0.5, this.game.y(tile) + 0.5);
      ctx.beginPath();
      ctx.arc(p.x, p.y, PREVIEW_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /** Screen point of a tile corner (x, y) in tile coordinates. */
  private screenOf(x: number, y: number): { x: number; y: number } {
    return this.transformHandler.worldToScreenCoordinates(new Cell(x, y));
  }
}
