/**
 * AircraftLayer — GalloFront aviation overlay.
 *
 * A Canvas 2D layer over the WebGL map (like SpyLayer / CapitalLayer) that
 * draws every aircraft in the view, for every player — the WebGL unit pass
 * has no sprite for them:
 *  - a bomber: a dark triangle pointing at its target, a dashed red line to
 *    the target and the impact circle (bomberRadius tiles);
 *  - a fighter: a small light triangle, nose along its last move;
 *  - an air transport: a triangle with the troops it carries.
 * Aircraft move every tick: between two ticks each one glides from the tile
 * it held at the previous tick to its current one, so the layer repaints
 * every frame while aircraft are in view.
 */

import { Cell, UnitType } from "@openfront/engine-api/game/GameTypes";
import { renderNumber } from "@openfront/engine-lib/Format";
import type { Controller } from "../../Controller";
import type { TransformHandler } from "../../TransformHandler";
import type { GameView, UnitView } from "../../view";

/** Below this zoom (screen pixels per tile) the aircraft are hidden. */
const MIN_SCALE = 0.6;
const PLANE_TILES = 3.2;
const PLANE_MIN_PX = 9;
const PLANE_MAX_PX = 30;
/** One simulation tick (10 per second): the time an aircraft glides over. */
const TICK_MS = 100;

const AIRCRAFT_TYPES = [
  UnitType.Bomber,
  UnitType.Fighter,
  UnitType.AirTransport,
  UnitType.CommercialAircraft,
] as const;

export class AircraftLayer implements Controller {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  /** The tick last seen, and when it arrived (performance.now()). */
  private lastTick = -1;
  private lastTickAt = 0;

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
    private mount: HTMLElement,
  ) {}

  init() {
    const canvas = document.createElement("canvas");
    canvas.id = "aircraft-layer";
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
    const tick = this.game.ticks();
    if (tick !== this.lastTick) {
      this.lastTick = tick;
      this.lastTickAt = performance.now();
    }
    this.draw();
    requestAnimationFrame(this.frame);
  };

  private aircraft(): UnitView[] {
    return this.game.units(...AIRCRAFT_TYPES);
  }

  private draw() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (canvas === null || ctx === null) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const th = this.transformHandler;
    const planes = this.aircraft();
    const alpha = Math.min(1, (performance.now() - this.lastTickAt) / TICK_MS);

    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (th.scale < MIN_SCALE || planes.length === 0) return;

    const size = Math.min(
      PLANE_MAX_PX,
      Math.max(PLANE_MIN_PX, th.scale * PLANE_TILES),
    );
    const me = this.game.myPlayer();
    const bomberRadius = this.game.config().bomberRadius();

    for (const plane of planes) {
      const tile = plane.tile();
      const from = this.glideFrom(plane, alpha);
      const owner = plane.owner();
      const mine =
        me !== null &&
        (owner.id() === me.id() ||
          (typeof owner.isFriendly === "function" && owner.isFriendly(me)));
      const type = plane.type();
      const dst = plane.targetTile();

      // Heading: toward the target for bombers / transports, else along the
      // last move; nose up when unknown.
      let heading = -Math.PI / 2;
      const towards = dst ?? this.lastDifferentTile(plane);
      if (towards !== undefined && towards !== tile) {
        const to = this.screenOf(towards);
        heading = Math.atan2(to.y - from.y, to.x - from.x);
      }

      if (type === UnitType.Bomber && dst !== undefined) {
        const to = this.screenOf(dst);
        ctx.save();
        ctx.setLineDash([Math.max(2, size * 0.3), Math.max(2, size * 0.3)]);
        ctx.lineWidth = Math.max(1, size * 0.07);
        ctx.strokeStyle = "rgba(239, 68, 68, 0.8)";
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.restore();
        if (th.isOnScreen(this.cellOf(dst))) {
          drawImpact(ctx, to.x, to.y, bomberRadius * th.scale, size);
        }
      } else if (type === UnitType.AirTransport && dst !== undefined && mine) {
        const to = this.screenOf(dst);
        ctx.save();
        ctx.setLineDash([Math.max(2, size * 0.3), Math.max(2, size * 0.3)]);
        ctx.lineWidth = Math.max(1, size * 0.07);
        ctx.strokeStyle = "rgba(226, 232, 240, 0.7)";
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.restore();
      }

      if (!th.isOnScreen(this.cellOf(tile))) continue;

      switch (type) {
        case UnitType.Bomber:
          drawPlane(ctx, from.x, from.y, size, heading, "#1e293b", mine);
          break;
        case UnitType.Fighter:
          drawPlane(ctx, from.x, from.y, size * 0.7, heading, "#e2e8f0", mine);
          break;
        case UnitType.CommercialAircraft:
          // Airliners are white with a gold wash, so they read as civil traffic.
          drawPlane(ctx, from.x, from.y, size * 0.8, heading, "#fde68a", mine);
          break;
        case UnitType.AirTransport: {
          drawPlane(ctx, from.x, from.y, size * 0.9, heading, "#64748b", mine);
          drawLabel(
            ctx,
            from.x,
            from.y + size * 0.75,
            renderNumber(plane.troops()),
            size,
          );
          break;
        }
      }
    }
  }

  /** Where to draw a plane between ticks: part-way from its last tile to its current one. */
  private glideFrom(plane: UnitView, alpha: number): { x: number; y: number } {
    const now = this.screenOf(plane.tile());
    const was = this.screenOf(plane.lastTile());
    return {
      x: was.x + (now.x - was.x) * alpha,
      y: was.y + (now.y - was.y) * alpha,
    };
  }

  /** The most recent previous tile that differs from the current one. */
  private lastDifferentTile(unit: UnitView): number | undefined {
    const current = unit.tile();
    const past = unit.lastTiles();
    for (let i = past.length - 1; i >= 0; i--) {
      if (past[i] !== current) return past[i];
    }
    return undefined;
  }

  private cellOf(tile: number): Cell {
    return new Cell(this.game.x(tile) + 0.5, this.game.y(tile) + 0.5);
  }

  private screenOf(tile: number): { x: number; y: number } {
    return this.transformHandler.worldToScreenCoordinates(this.cellOf(tile));
  }
}

/**
 * A simple delta-wing silhouette centred on (x, y), nose along `heading`
 * (radians, screen space); `s` is its length. Friendly aircraft get a
 * light outline, enemy ones a red one, so they read on any territory.
 */
function drawPlane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  heading: number,
  fill: string,
  mine: boolean,
) {
  const half = s / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, s * 0.09);
  ctx.strokeStyle = mine
    ? "rgba(255, 255, 255, 0.9)"
    : "rgba(239, 68, 68, 0.95)";
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(half, 0); // nose
  ctx.lineTo(-half * 0.7, half * 0.6);
  ctx.lineTo(-half * 0.4, 0);
  ctx.lineTo(-half * 0.7, -half * 0.6);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

/** The bomb's impact area: a red ring with a crosshair at its centre. */
function drawImpact(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  s: number,
) {
  ctx.save();
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
  ctx.fillStyle = "rgba(239, 68, 68, 0.12)";
  ctx.beginPath();
  ctx.arc(x, y, Math.max(2, r), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const c = Math.max(3, s * 0.35);
  ctx.beginPath();
  ctx.moveTo(x - c, y);
  ctx.lineTo(x + c, y);
  ctx.moveTo(x, y - c);
  ctx.lineTo(x, y + c);
  ctx.stroke();
  ctx.restore();
}

/** Troop count under an air transport. */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  s: number,
) {
  ctx.save();
  ctx.font = `bold ${Math.max(9, Math.round(s * 0.45))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fillStyle = "#f8fafc";
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}
