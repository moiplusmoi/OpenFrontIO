/**
 * AircraftLayer — GalloFront aviation overlay.
 *
 * A Canvas 2D layer over the WebGL map (like FleetLayer) that draws every
 * aircraft in the view, for every player — the WebGL unit pass has no sprite
 * for them. Each aircraft is a top-down silhouette with a ground shadow:
 *  - a bomber: a four-engined heavy bomber, dashed red line to its target
 *    and the impact circle (bomberRadius tiles);
 *  - a fighter: a slim delta-wing jet with an afterburner glow;
 *  - an air transport: a broad high-wing cargo plane with the troops it carries;
 *  - an airliner: a white airliner with a cargo stripe (gold or troops).
 * Wings and tail take the owner's colour, as ships do.
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
const PLANE_TILES = 7.5;
const PLANE_MIN_PX = 22;
const PLANE_MAX_PX = 70;
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
  /** Cargo of each airliner, read off its origin airport the first time it is seen. */
  private cargoByPlane = new Map<number, "gold" | "troops" | null>();

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

      let kind: PlaneKind;
      let scale = 1;
      let accent: string | null = null;
      switch (type) {
        case UnitType.Bomber:
          kind = "bomber";
          break;
        case UnitType.Fighter:
          kind = "fighter";
          scale = 0.8;
          break;
        case UnitType.AirTransport:
          kind = "transport";
          scale = 0.95;
          break;
        case UnitType.CommercialAircraft:
          kind = "airliner";
          scale = 0.9;
          // Gold airliners carry gold; troop airliners (reinforcements) carry green.
          accent = this.cargoOf(plane) === "troops" ? "#86efac" : "#fbbf24";
          break;
        default:
          continue;
      }
      const span = size * scale;
      const fill = owner.territoryColor().toHex();
      drawPlane(
        ctx,
        from.x + span * 0.12,
        from.y + span * 0.2,
        span,
        heading,
        kind,
        fill,
        accent,
        mine,
        true,
      );
      drawPlane(ctx, from.x, from.y, span, heading, kind, fill, accent, mine);

      if (type === UnitType.AirTransport) {
        drawLabel(
          ctx,
          from.x,
          from.y + span * 0.75,
          renderNumber(plane.troops()),
          span,
        );
      }
    }
  }

  /**
   * The route's cargo. An airliner is built on its origin airport, so the
   * first sighting, on that tile, names the route; a plane first seen in
   * mid-flight has no origin and stays unlabelled.
   */
  private cargoOf(plane: UnitView): "gold" | "troops" | null {
    const known = this.cargoByPlane.get(plane.id());
    if (known !== undefined) return known;
    if (this.cargoByPlane.size > 2000) this.cargoByPlane.clear();
    const dst = plane.targetUnitId();
    const origin = this.game
      .units(UnitType.Airport)
      .find((a) => a.tile() === plane.tile());
    const cargo =
      origin !== undefined && dst !== undefined
        ? this.game.config().airlinerCargo(origin.id(), dst)
        : null;
    this.cargoByPlane.set(plane.id(), cargo);
    return cargo;
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

type Pt = [number, number];
type PlaneKind = "bomber" | "fighter" | "transport" | "airliner";

const SHADOW = "rgba(0, 0, 0, 0.3)";

/** Allies get a white outline, enemies a red one, so they read on any land. */
function strokeStyleFor(mine: boolean): string {
  return mine ? "rgba(255, 255, 255, 0.9)" : "rgba(239, 68, 68, 0.95)";
}

/**
 * A top-down aircraft silhouette centred on (x, y), nose along `heading`
 * (radians, screen space); `s` is its span. Shapes are written in half-spans
 * (h): +x is the nose, y runs port to starboard, and wings are drawn with
 * their mirror image. Wings and tail take the owner's colour; the outline
 * shows allies (white) and enemies (red) apart. With `shadow` set, the same
 * shape is drawn flat black for the ground shadow. Small aircraft skip the
 * details (engines, canopy) to stay legible.
 */
function drawPlane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  heading: number,
  kind: PlaneKind,
  owner: string,
  accent: string | null,
  mine: boolean,
  shadow = false,
) {
  const h = s / 2;
  const detail = !shadow && s >= 14;
  const paint = (c: string) => (shadow ? SHADOW : c);

  const trace = (pts: Pt[]) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => {
      if (i === 0) ctx.moveTo(px * h, py * h);
      else ctx.lineTo(px * h, py * h);
    });
    ctx.closePath();
  };
  const shape = (pts: Pt[], fill: string) => {
    trace(pts);
    ctx.fillStyle = paint(fill);
    ctx.fill();
    if (!shadow) ctx.stroke();
  };
  // A wing or tail given once on one side; its mirror image is drawn too.
  const pair = (pts: Pt[], fill: string) => {
    shape(pts, fill);
    shape(
      pts.map(([px, py]): Pt => [px, -py]),
      fill,
    );
  };
  const dot = (cx: number, cy: number, r: number, fill: string) => {
    ctx.beginPath();
    ctx.arc(cx * h, cy * h, Math.max(1, r * h), 0, Math.PI * 2);
    ctx.fillStyle = paint(fill);
    ctx.fill();
    if (!shadow) ctx.stroke();
  };

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeStyle = strokeStyleFor(mine);

  switch (kind) {
    case "bomber":
      pair(
        [
          [0.15, -0.12],
          [-0.35, -0.95],
          [-0.62, -0.95],
          [-0.3, -0.1],
        ],
        owner,
      );
      pair(
        [
          [-0.7, -0.1],
          [-0.95, -0.42],
          [-1, -0.42],
          [-0.9, -0.08],
        ],
        owner,
      );
      shape(
        [
          [1, 0],
          [0.8, -0.14],
          [-0.4, -0.13],
          [-0.95, -0.06],
          [-0.95, 0.06],
          [-0.4, 0.13],
          [0.8, 0.14],
        ],
        "#475569",
      );
      if (detail) {
        dot(0, -0.5, 0.09, "#1e293b");
        dot(0, 0.5, 0.09, "#1e293b");
        dot(0.78, 0, 0.09, "rgba(186, 230, 253, 0.85)");
      }
      break;

    case "fighter":
      pair(
        [
          [0.3, -0.1],
          [-0.55, -0.95],
          [-0.8, -0.9],
          [-0.5, -0.1],
        ],
        owner,
      );
      pair(
        [
          [-0.7, -0.08],
          [-1, -0.45],
          [-0.85, -0.45],
          [-0.6, -0.08],
        ],
        owner,
      );
      shape(
        [
          [1, 0],
          [0.5, -0.14],
          [-0.6, -0.12],
          [-1, -0.05],
          [-1, 0.05],
          [-0.6, 0.12],
          [0.5, 0.14],
        ],
        "#cbd5e1",
      );
      if (detail) {
        dot(0.35, 0, 0.12, "rgba(186, 230, 253, 0.9)");
        dot(-1, 0, 0.12, "rgba(251, 146, 60, 0.9)");
      }
      break;

    case "transport":
      pair(
        [
          [0.25, -0.2],
          [0.12, -0.98],
          [-0.22, -0.98],
          [-0.26, -0.2],
        ],
        owner,
      );
      pair(
        [
          [-0.72, -0.18],
          [-0.96, -0.5],
          [-1, -0.5],
          [-0.94, -0.16],
        ],
        owner,
      );
      shape(
        [
          [0.92, -0.2],
          [0.98, 0],
          [0.92, 0.2],
          [-0.9, 0.22],
          [-1, 0],
          [-0.9, -0.22],
        ],
        "#94a3b8",
      );
      if (detail) {
        dot(0.2, -0.6, 0.1, "#334155");
        dot(0.2, 0.6, 0.1, "#334155");
        // Rear ramp.
        shape(
          [
            [-0.72, -0.14],
            [-0.9, -0.14],
            [-0.9, 0.14],
            [-0.72, 0.14],
          ],
          "#334155",
        );
      }
      break;

    case "airliner":
      pair(
        [
          [0.15, -0.15],
          [-0.25, -0.92],
          [-0.5, -0.92],
          [-0.36, -0.15],
        ],
        owner,
      );
      pair(
        [
          [-0.7, -0.1],
          [-0.92, -0.36],
          [-1, -0.36],
          [-0.88, -0.08],
        ],
        owner,
      );
      shape(
        [
          [1, 0],
          [0.82, -0.17],
          [-0.7, -0.17],
          [-1, -0.07],
          [-1, 0.07],
          [-0.7, 0.17],
          [0.82, 0.17],
        ],
        "#f8fafc",
      );
      if (accent !== null) {
        shape(
          [
            [0.55, -0.07],
            [-0.7, -0.07],
            [-0.7, 0.07],
            [0.55, 0.07],
          ],
          accent,
        );
      }
      if (detail) {
        dot(0.1, -0.5, 0.1, "#cbd5e1");
        dot(0.1, 0.5, 0.1, "#cbd5e1");
      }
      break;
  }
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
