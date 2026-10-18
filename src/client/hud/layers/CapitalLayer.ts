/**
 * CapitalLayer — GalloFront: draws a small crown above every player's
 * capital city.
 *
 * A Canvas 2D overlay on top of the WebGL map (inside the input overlay, so
 * it moves with the camera but never catches pointer events). The WebGL
 * structure pass draws its icons from a baked atlas, so adding a crown
 * there would mean regenerating the atlas; this layer draws a vector crown
 * instead and only repaints when the camera or a capital changes.
 */

import type { TileRef } from "@openfront/engine-api/game/GameMap";
import { Cell } from "@openfront/engine-api/game/GameTypes";
import type { Controller } from "../../Controller";
import type { TransformHandler } from "../../TransformHandler";
import type { GameView } from "../../view";

/** Below this zoom (screen pixels per tile) the crowns are hidden. */
const MIN_SCALE = 0.9;
/** Crown width in pixels: `scale * CROWN_TILES`, clamped. */
const CROWN_TILES = 2.4;
const CROWN_MIN_PX = 10;
const CROWN_MAX_PX = 28;

export class CapitalLayer implements Controller {
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
    canvas.id = "capital-layer";
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
    if (this.canvas === null || !this.canvas.isConnected) {
      // The input overlay was removed (game over / left): stop.
      return;
    }
    this.draw();
    requestAnimationFrame(this.frame);
  };

  /** The capitals to draw: [smallID, tile] pairs for alive players. */
  private capitals(): [number, TileRef][] {
    const out: [number, TileRef][] = [];
    for (const p of this.game.playerViews()) {
      const tile = p.capitalTile();
      if (tile !== null && p.isAlive()) out.push([p.smallID(), tile]);
    }
    return out;
  }

  private draw() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (canvas === null || ctx === null) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const th = this.transformHandler;
    const capitals = this.capitals();

    const signature =
      `${cssW}x${cssH}@${dpr}|${th.scale}|${th.offsetX}|${th.offsetY}|` +
      capitals.map(([id, t]) => `${id}:${t}`).join(",");
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

    if (th.scale < MIN_SCALE || capitals.length === 0) return;

    const size = Math.min(
      CROWN_MAX_PX,
      Math.max(CROWN_MIN_PX, th.scale * CROWN_TILES),
    );
    const myID = this.game.myPlayer()?.smallID();

    for (const [smallID, tile] of capitals) {
      const cell = new Cell(this.game.x(tile) + 0.5, this.game.y(tile) + 0.5);
      if (!th.isOnScreen(cell)) continue;
      const { x, y } = th.worldToScreenCoordinates(cell);
      // Sit the crown just above the city icon (about one tile up).
      const bottom = y - Math.max(4, th.scale * 1.2);
      drawCrown(ctx, x, bottom, size, smallID === myID);
    }
  }
}

/**
 * A simple vector crown: three points on a band, gold with a dark outline so
 * it reads on any territory colour. `x` is the horizontal centre and
 * `bottom` the y of the band's lower edge; `w` the total width.
 */
function drawCrown(
  ctx: CanvasRenderingContext2D,
  x: number,
  bottom: number,
  w: number,
  mine: boolean,
) {
  const h = w * 0.72;
  const half = w / 2;
  const top = bottom - h;
  const bandH = h * 0.28;

  ctx.beginPath();
  ctx.moveTo(x - half, bottom);
  ctx.lineTo(x - half, top + h * 0.3);
  ctx.lineTo(x - half * 0.5, bottom - bandH - h * 0.22);
  ctx.lineTo(x, top);
  ctx.lineTo(x + half * 0.5, bottom - bandH - h * 0.22);
  ctx.lineTo(x + half, top + h * 0.3);
  ctx.lineTo(x + half, bottom);
  ctx.closePath();

  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, w * 0.1);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
  ctx.stroke();
  ctx.fillStyle = mine ? "#ffd84a" : "#f2b632";
  ctx.fill();

  // Band highlight and a jewel in the middle.
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.fillRect(x - half + w * 0.08, bottom - bandH, w - w * 0.16, bandH * 0.4);
  ctx.beginPath();
  ctx.arc(x, bottom - bandH * 0.5, Math.max(0.8, w * 0.08), 0, Math.PI * 2);
  ctx.fillStyle = mine ? "#e11d48" : "#1d4ed8";
  ctx.fill();
}
