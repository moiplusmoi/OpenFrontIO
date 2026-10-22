/**
 * FleetLayer — GalloFront frigates and destroyers.
 *
 * A Canvas 2D layer over the WebGL map, like AircraftLayer, for the two ship
 * types the unit atlas has no sprite for:
 *  - a frigate: a slim hull with a single mast, quick and easy to spot;
 *  - a destroyer: a longer hull with a superstructure and two gun turrets.
 * Hulls take their owner's colour; an outline shows allies (white) and enemies
 * (red) apart. Ships move, so the layer repaints when a position, the camera
 * or the canvas size changes.
 */

import {
  Cell,
  SurfaceCombatants,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { Controller } from "../../Controller";
import type { TransformHandler } from "../../TransformHandler";
import type { GameView, PlayerView, UnitView } from "../../view";

/** Below this zoom (screen pixels per tile) the ships are hidden. */
const MIN_SCALE = 0.6;
const SHIP_TILES = 3.2;
const SHIP_MIN_PX = 8;
const SHIP_MAX_PX = 26;

const FLEET_TYPES = [
  UnitType.Frigate,
  UnitType.Destroyer,
  UnitType.Submarine,
] as const;

export class FleetLayer implements Controller {
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
    canvas.id = "fleet-layer";
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

  private ships(): UnitView[] {
    return this.game.units(...FLEET_TYPES);
  }

  private draw() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (canvas === null || ctx === null) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const th = this.transformHandler;
    const me = this.game.myPlayer();
    // Enemy submarines are drawn only while one of our surface ships or ports
    // is in sonar range (see isSubmarineDetectedBy in the engine).
    const detectors =
      me === null
        ? []
        : this.game
            .units(...SurfaceCombatants, UnitType.Port)
            .filter((u) => u.owner() === me || me.isFriendly(u.owner()));
    const ships = this.ships().filter((ship) =>
      this.canSee(ship, me, detectors),
    );

    const signature =
      `${cssW}x${cssH}@${dpr}|${th.scale}|${th.offsetX}|${th.offsetY}|` +
      ships.map((u) => `${u.id()}:${u.tile()}`).join(",") +
      `|${detectors.map((u) => u.tile()).join(",")}`;
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

    if (th.scale < MIN_SCALE || ships.length === 0) return;

    const size = Math.min(
      SHIP_MAX_PX,
      Math.max(SHIP_MIN_PX, th.scale * SHIP_TILES),
    );
    for (const ship of ships) {
      const tile = ship.tile();
      if (!th.isOnScreen(this.cellOf(tile))) continue;

      const owner = ship.owner();
      const mine =
        me !== null &&
        (owner.id() === me.id() ||
          (typeof owner.isFriendly === "function" && owner.isFriendly(me)));
      const fill = owner.territoryColor().toHex();
      const { x, y } = this.screenOf(tile);
      const heading = this.headingOf(ship);

      switch (ship.type()) {
        case UnitType.Destroyer:
          drawDestroyer(ctx, x, y, size * 1.1, heading, fill, mine);
          break;
        case UnitType.Submarine:
          // Our own submarines show faint (submerged); a detected enemy is solid.
          ctx.globalAlpha = mine ? 0.55 : 1;
          drawSubmarine(ctx, x, y, size * 0.9, heading, fill, mine);
          ctx.globalAlpha = 1;
          break;
        default:
          drawFrigate(ctx, x, y, size * 0.8, heading, fill, mine);
      }
    }
  }

  /**
   * Whether `me` can see a ship. Only submarines are ever hidden: friends
   * always see them, enemies only inside sonar range of a detector.
   */
  private canSee(
    ship: UnitView,
    me: PlayerView | null,
    detectors: UnitView[],
  ): boolean {
    if (ship.type() !== UnitType.Submarine) return true;
    const owner = ship.owner();
    if (me !== null && (owner === me || me.isFriendly(owner))) return true;
    const range = this.game.config().submarineDetectionRange();
    const tile = ship.tile();
    return detectors.some(
      (d) =>
        Math.abs(this.game.x(d.tile()) - this.game.x(tile)) +
          Math.abs(this.game.y(d.tile()) - this.game.y(tile)) <=
        range,
    );
  }

  /** Nose toward the last move, or straight up when the ship has not moved. */
  private headingOf(ship: UnitView): number {
    const tile = ship.tile();
    for (const past of ship.lastTiles().slice().reverse()) {
      if (past !== tile) {
        const from = this.screenOf(past);
        const to = this.screenOf(tile);
        return Math.atan2(to.y - from.y, to.x - from.x);
      }
    }
    return -Math.PI / 2;
  }

  private cellOf(tile: number): Cell {
    return new Cell(this.game.x(tile) + 0.5, this.game.y(tile) + 0.5);
  }

  private screenOf(tile: number): { x: number; y: number } {
    return this.transformHandler.worldToScreenCoordinates(this.cellOf(tile));
  }
}

/** Shared hull outline: bow at +half, stern at -half, given beam at midships. */
function hullPath(ctx: CanvasRenderingContext2D, half: number, beam: number) {
  ctx.beginPath();
  ctx.moveTo(half, 0); // bow
  ctx.lineTo(half * 0.35, beam);
  ctx.lineTo(-half * 0.8, beam * 0.75);
  ctx.lineTo(-half, 0); // stern
  ctx.lineTo(-half * 0.8, -beam * 0.75);
  ctx.lineTo(half * 0.35, -beam);
  ctx.closePath();
}

function strokeStyleFor(mine: boolean): string {
  return mine ? "rgba(255, 255, 255, 0.9)" : "rgba(239, 68, 68, 0.95)";
}

/** Slim hull with one mast: quick raider. */
function drawFrigate(
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
  ctx.strokeStyle = strokeStyleFor(mine);
  ctx.fillStyle = fill;
  hullPath(ctx, half, half * 0.38);
  ctx.stroke();
  ctx.fill();
  // Mast, a short white line amidships.
  ctx.beginPath();
  ctx.moveTo(-half * 0.1, 0);
  ctx.lineTo(-half * 0.1, -half * 0.5);
  ctx.strokeStyle = "rgba(248, 250, 252, 0.9)";
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.stroke();
  ctx.restore();
}

/** Longer hull with a superstructure and two turrets: the line's heavy ship. */
function drawDestroyer(
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
  ctx.strokeStyle = strokeStyleFor(mine);
  ctx.fillStyle = fill;
  hullPath(ctx, half, half * 0.42);
  ctx.stroke();
  ctx.fill();
  // Superstructure amidships.
  ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
  ctx.fillRect(-half * 0.25, -half * 0.22, half * 0.5, half * 0.44);
  // Two turrets, fore and aft.
  ctx.fillStyle = "rgba(248, 250, 252, 0.9)";
  for (const tx of [half * 0.45, -half * 0.55]) {
    ctx.beginPath();
    ctx.arc(tx, 0, Math.max(1, s * 0.09), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Long, narrow hull with a conning tower and a periscope: the stealth raider. */
function drawSubmarine(
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
  ctx.strokeStyle = strokeStyleFor(mine);
  ctx.fillStyle = fill;
  hullPath(ctx, half, half * 0.22);
  ctx.stroke();
  ctx.fill();
  // Conning tower, a little forward of midships.
  ctx.fillStyle = "rgba(15, 23, 42, 0.6)";
  ctx.fillRect(-half * 0.15, -half * 0.16, half * 0.45, half * 0.32);
  // Periscope.
  ctx.beginPath();
  ctx.moveTo(half * 0.1, 0);
  ctx.lineTo(half * 0.1, -half * 0.28);
  ctx.strokeStyle = "rgba(248, 250, 252, 0.9)";
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.stroke();
  ctx.restore();
}
