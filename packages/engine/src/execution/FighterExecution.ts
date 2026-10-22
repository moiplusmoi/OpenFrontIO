import { TileRef } from "@openfront/engine-api/game/GameMap";
import { MessageType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zInt,
  zPlayerRef,
  zRandom,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import {
  AirPathFinderSchema,
  airPathFinderState,
  restoreAirPathFinder,
} from "../snapshot/PathfinderSnapshots";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

const PREY: readonly UnitType[] = [
  UnitType.AirTransport,
  UnitType.Bomber,
  UnitType.HydrogenBomb,
  UnitType.AtomBomb,
];
const ORBIT_POINTS = 8;
const ORBIT_RADIUS = 20;
const ORBIT_STEP_TICKS = 10;

/**
 * GalloFront: a fighter orbits its home airport and chases enemy aircraft
 * (and, with lower odds, nukes) that enter its patrol range. One roll per
 * target per fighter. It dies with its airport or when the airport changes
 * hands, and has a single hit point against SAMs.
 */
export class FighterExecution implements Execution {
  private active = true;
  private mg: Game;
  private fighter: Unit | null = null;
  private home: Unit | null = null;
  private rand: PseudoRandom | null = null;
  private pathFinder: SteppingPathFinder<TileRef>;
  private engageCooldown = 0;
  private engaged: number[] = [];
  private orbit = 0;
  private orbitTick = 0;

  constructor(
    private player: Player,
    private airportTile: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
    this.pathFinder = PathFinding.Air(mg);
  }

  tick(ticks: number): void {
    if (this.fighter === null) {
      const spawn = this.player.canBuild(UnitType.Fighter, this.airportTile);
      if (spawn === false) {
        this.active = false;
        return;
      }
      const home = this.player
        .units(UnitType.Airport, UnitType.Carrier)
        .find((a) => a.tile() === spawn);
      if (home === undefined) {
        this.active = false;
        return;
      }
      this.home = home;
      this.fighter = this.player.buildUnit(UnitType.Fighter, spawn, {
        targetUnit: home,
      });
      this.rand = new PseudoRandom(this.fighter.id());
      this.orbitTick = ticks;
      return;
    }
    const fighter = this.fighter;
    const home = this.home;
    if (!fighter.isActive()) {
      this.active = false;
      return;
    }
    if (home === null || !home.isActive() || home.owner() !== fighter.owner()) {
      fighter.delete(false);
      this.active = false;
      return;
    }
    const cfg = this.mg.config();
    if (this.engageCooldown > 0) this.engageCooldown--;
    const target = this.engageCooldown === 0 ? this.findTarget(home) : null;
    if (target !== null) {
      this.fly(target.tile(), cfg.fighterSpeed());
      if (
        this.mg.manhattanDist(fighter.tile(), target.tile()) <=
        cfg.fighterEngageRange()
      ) {
        this.engaged.push(target.id());
        this.engageCooldown = cfg.fighterEngageCooldown();
        const chance = cfg.fighterInterceptChance(target.type());
        if (this.rand!.nextInt(0, 99) < chance) {
          const victim = target.owner();
          target.delete(true, this.player);
          this.mg.displayMessage(
            "events_display.fighter_intercept",
            MessageType.FIGHTER_INTERCEPT,
            this.player.id(),
            undefined,
            { unit: target.type() },
          );
          if (victim.isPlayer()) {
            this.mg.displayMessage(
              "events_display.aircraft_shot_down",
              MessageType.AIRCRAFT_SHOT_DOWN,
              victim.id(),
              undefined,
              { unit: target.type(), name: this.player.displayName() },
            );
          }
        }
      }
      return;
    }
    // patrol: hop between orbit points around the airport
    if (ticks - this.orbitTick >= ORBIT_STEP_TICKS) {
      this.orbitTick = ticks;
      this.orbit = (this.orbit + 1) % ORBIT_POINTS;
    }
    this.fly(this.orbitPoint(home.tile()), cfg.fighterSpeed());
  }

  private findTarget(home: Unit): Unit | null {
    const cfg = this.mg.config();
    const candidates = this.mg.nearbyUnits(
      home.tile(),
      cfg.fighterPatrolRange(),
      PREY,
      ({ unit: u }) =>
        u.owner() !== this.player &&
        !this.player.isFriendly(u.owner() as Player) &&
        !this.engaged.includes((u as Unit).id()),
    );
    if (candidates.length === 0) return null;
    const rank = (t: UnitType) => PREY.indexOf(t);
    candidates.sort(
      (a, b) =>
        rank(a.unit.type()) - rank(b.unit.type()) ||
        a.distSquared - b.distSquared ||
        a.unit.id() - b.unit.id(),
    );
    return candidates[0].unit;
  }

  private orbitPoint(center: TileRef): TileRef {
    // 8 points on a square ring: integer offsets only (no trigonometry).
    const offsets: [number, number][] = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ];
    const [ox, oy] = offsets[this.orbit];
    const x = this.mg.x(center) + ox * ORBIT_RADIUS;
    const y = this.mg.y(center) + oy * ORBIT_RADIUS;
    if (x < 0 || y < 0 || x >= this.mg.width() || y >= this.mg.height()) {
      return center;
    }
    return this.mg.ref(x, y);
  }

  private fly(to: TileRef, speed: number): void {
    const fighter = this.fighter!;
    for (let i = 0; i < speed; i++) {
      const result = this.pathFinder.next(fighter.tile(), to);
      if (result.status === PathStatus.NEXT) fighter.move(result.node);
      else break;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return FighterExecutionSnapshot.write({
      active: this.active,
      player: w.player(this.player),
      airportTile: this.airportTile,
      fighter: this.fighter === null ? null : w.unit(this.fighter),
      home: this.home === null ? null : w.unit(this.home),
      rand: this.rand === null ? null : w.random(this.rand),
      engageCooldown: this.engageCooldown,
      engaged: [...this.engaged],
      orbit: this.orbit,
      orbitTick: this.orbitTick,
      pathFinder:
        this.mg === undefined ? null : airPathFinderState(this.pathFinder),
    });
  }

  restoreSnapshot(s: FighterState, r: SnapshotReader): void {
    this.active = s.active;
    this.player = r.player(s.player);
    this.airportTile = s.airportTile;
    this.fighter = s.fighter === null ? null : r.unit(s.fighter);
    this.home = s.home === null ? null : r.unit(s.home);
    this.rand = s.rand === null ? null : r.random(s.rand);
    this.engageCooldown = s.engageCooldown;
    this.engaged = [...s.engaged];
    this.orbit = s.orbit;
    this.orbitTick = s.orbitTick;
    if (s.pathFinder !== null) {
      this.mg = r.game;
      this.pathFinder = restoreAirPathFinder(r.game, s.pathFinder);
    }
  }
}

const FighterStateSchema = z.object({
  active: z.boolean(),
  player: zPlayerRef(),
  airportTile: zTile(),
  fighter: zRef().nullable(),
  home: zRef().nullable(),
  rand: zRandom().nullable(),
  engageCooldown: zInt(),
  engaged: z.array(zInt()),
  orbit: zInt(),
  orbitTick: zInt(),
  pathFinder: AirPathFinderSchema.nullable(),
});
type FighterState = z.infer<typeof FighterStateSchema>;

export const FighterExecutionSnapshot = execSnapshotType({
  name: "Fighter",
  version: 1,
  schema: FighterStateSchema,
  cls: () => FighterExecution,
});
