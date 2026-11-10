/**
 * DepositLayer — GalloFront: marks the resource deposits on the map, so a
 * player can see where a mine can go.
 *
 * The deposits are not sent by the server: the engine places them from the
 * map and the game ID (generateResourceDeposits), and the client runs the
 * same function, so both sides agree on every tile. The markers are drawn on
 * a Canvas 2D overlay above the WebGL map (like CapitalLayer): they follow the
 * camera and never catch pointer events. They are placed once, then only
 * repainted when the camera moves.
 */

import { ResourceType } from "@openfront/engine-api/game/GameTypes";
import { Cell } from "@openfront/engine-api/game/GameTypes";
import type { TileRef } from "@openfront/engine-api/game/GameMap";
import { generateResourceDeposits } from "@openfront/engine-lib/game/ResourceDeposits";
import type { Controller } from "../../Controller";
import type { TransformHandler } from "../../TransformHandler";
import type { GameView } from "../../view";

/** Below this zoom (screen pixels per tile) the markers are hidden. */
const MIN_SCALE = 0.6;
const MARK_MIN_PX = 6;
const MARK_MAX_PX = 14;
const MARK_TILES = 1.2;

const COLOR: Record<ResourceType, string> = {
  [ResourceType.Oil]: "#111827",
  [ResourceType.Metal]: "#cbd5e1",
  [ResourceType.Food]: "#84cc16",
};

const LETTER: Record<ResourceType, string> = {
  [ResourceType.Oil]: "O",
  [ResourceType.Metal]: "M",
  [ResourceType.Food]: "F",
};

export class DepositLayer implements Controller {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastSignature = "";
  private deposits: [TileRef, ResourceType][] = [];

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
    private mount: HTMLElement,
  ) {}

  init() {
    // Same function as the engine, same map, same game ID: same deposits.
    this.deposits = [
      ...generateResourceDeposits(this.game.gameMap(), this.game.gameID()),
    ];
    const canvas = document.createElement("canvas");
    canvas.id = "deposit-layer";
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

  private draw() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (canvas === null || ctx === null) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const th = this.transformHandler;

    const signature = `${cssW}x${cssH}@${dpr}|${th.scale}|${th.offsetX}|${th.offsetY}`;
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

    const size = Math.min(
      MARK_MAX_PX,
      Math.max(MARK_MIN_PX, th.scale * MARK_TILES),
    );
    for (const [tile, resource] of this.deposits) {
      const cell = new Cell(this.game.x(tile) + 0.5, this.game.y(tile) + 0.5);
      if (!th.isOnScreen(cell)) continue;
      const { x, y } = th.worldToScreenCoordinates(cell);
      drawMarker(ctx, x, y, size, resource);
    }
  }
}

/** A round badge with the resource's letter, readable on any territory. */
function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  resource: ResourceType,
) {
  const r = size / 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = COLOR[resource];
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.12);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.stroke();

  ctx.fillStyle = resource === ResourceType.Metal ? "#0a1628" : "#ffffff";
  ctx.font = `bold ${Math.round(size * 0.6)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(LETTER[resource], x, y + size * 0.04);
}
