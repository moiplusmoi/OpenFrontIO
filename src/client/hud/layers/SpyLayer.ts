/**
 * SpyLayer — GalloFront espionage overlay.
 *
 * A Canvas 2D layer over the WebGL map (like CapitalLayer) that draws:
 *  - the local player's (and teammates') spies in flight: a small dark
 *    silhouette on the spy's tile and a dashed line to its destination.
 *    Other players' spies never reach the view (GameView hides them), and
 *    the WebGL unit pass has no sprite for a spy, so this is their only
 *    rendering;
 *  - a red "⚡" over every sabotaged structure (SAM/silo disabled until
 *    `disabledUntil`), for every player, so the owner sees what stopped
 *    working and the attacker sees that the sabotage took.
 */

import { Cell, UnitType } from "@openfront/engine-api/game/GameTypes";
import type { Controller } from "../../Controller";
import type { TransformHandler } from "../../TransformHandler";
import type { GameView, UnitView } from "../../view";

/** Below this zoom (screen pixels per tile) the markers are hidden. */
const MIN_SCALE = 0.9;
const MARK_TILES = 2.2;
const MARK_MIN_PX = 9;
const MARK_MAX_PX = 26;

export class SpyLayer implements Controller {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastSignature = "";

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
    private mount: HTMLElement,
  ) {}

  init() {
    const canvas = document.createElement("canvas");
    canvas.id = "spy-layer";
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

  /** Spies in the view: only mine and my teammates' (GameView filters). */
  private spies(): UnitView[] {
    return this.game.units(UnitType.Spy);
  }

  /** Structures currently sabotaged. */
  private sabotaged(ticks: number): UnitView[] {
    return this.game
      .units(UnitType.SAMLauncher, UnitType.MissileSilo)
      .filter((u) => u.isDisabled(ticks));
  }

  private draw() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (canvas === null || ctx === null) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const th = this.transformHandler;
    const ticks = this.game.ticks();
    const spies = this.spies();
    const sabotaged = this.sabotaged(ticks);

    const signature =
      `${cssW}x${cssH}@${dpr}|${th.scale}|${th.offsetX}|${th.offsetY}|` +
      spies.map((u) => `${u.id()}:${u.tile()}`).join(",") +
      "|" +
      sabotaged.map((u) => `${u.id()}:${u.disabledUntil() - ticks}`).join(",");
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (th.scale < MIN_SCALE) return;
    if (spies.length === 0 && sabotaged.length === 0) return;

    const size = Math.min(
      MARK_MAX_PX,
      Math.max(MARK_MIN_PX, th.scale * MARK_TILES),
    );

    for (const spy of spies) {
      const from = this.screenOf(spy.tile());
      const dst = spy.targetTile();
      if (dst !== undefined) {
        const to = this.screenOf(dst);
        ctx.save();
        ctx.setLineDash([Math.max(2, size * 0.25), Math.max(2, size * 0.25)]);
        ctx.lineWidth = Math.max(1, size * 0.08);
        ctx.strokeStyle = "rgba(15, 23, 42, 0.75)";
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.restore();
        drawCrosshair(ctx, to.x, to.y, size * 0.45);
      }
      if (th.isOnScreen(this.cellOf(spy.tile()))) {
        drawSpy(ctx, from.x, from.y, size);
      }
    }

    for (const unit of sabotaged) {
      const cell = this.cellOf(unit.tile());
      if (!th.isOnScreen(cell)) continue;
      const { x, y } = th.worldToScreenCoordinates(cell);
      drawBolt(ctx, x, y - Math.max(4, th.scale * 1.2), size);
    }
  }

  private cellOf(tile: number): Cell {
    return new Cell(this.game.x(tile) + 0.5, this.game.y(tile) + 0.5);
  }

  private screenOf(tile: number): { x: number; y: number } {
    return this.transformHandler.worldToScreenCoordinates(this.cellOf(tile));
  }
}

/** A dark hat-and-coat silhouette centred on (x, y); `s` is its height. */
function drawSpy(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
) {
  const half = s / 2;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, s * 0.1);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillStyle = "#0f172a";
  // Coat
  ctx.beginPath();
  ctx.moveTo(x - half * 0.7, y + half);
  ctx.lineTo(x - half * 0.45, y - half * 0.1);
  ctx.lineTo(x + half * 0.45, y - half * 0.1);
  ctx.lineTo(x + half * 0.7, y + half);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  // Head
  ctx.beginPath();
  ctx.arc(x, y - half * 0.35, half * 0.32, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
  // Hat brim and crown
  ctx.beginPath();
  ctx.rect(x - half * 0.75, y - half * 0.62, half * 1.5, half * 0.14);
  ctx.rect(x - half * 0.4, y - half, half * 0.8, half * 0.4);
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
) {
  ctx.save();
  ctx.lineWidth = Math.max(1, r * 0.2);
  ctx.strokeStyle = "rgba(15, 23, 42, 0.8)";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.moveTo(x - r * 1.4, y);
  ctx.lineTo(x + r * 1.4, y);
  ctx.moveTo(x, y - r * 1.4);
  ctx.lineTo(x, y + r * 1.4);
  ctx.stroke();
  ctx.restore();
}

/** A red lightning bolt whose bottom tip is at (x, bottom). */
function drawBolt(
  ctx: CanvasRenderingContext2D,
  x: number,
  bottom: number,
  s: number,
) {
  const top = bottom - s;
  const w = s * 0.45;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, s * 0.1);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.moveTo(x + w * 0.3, top);
  ctx.lineTo(x - w * 0.5, top + s * 0.55);
  ctx.lineTo(x + w * 0.05, top + s * 0.55);
  ctx.lineTo(x - w * 0.3, bottom);
  ctx.lineTo(x + w * 0.5, top + s * 0.4);
  ctx.lineTo(x - w * 0.05, top + s * 0.4);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}
