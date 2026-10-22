import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import { CommercialAircraftExecution } from "./CommercialAircraftExecution";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * GalloFront: an airport has `level` sortie slots. Each bomber / fighter /
 * paradrop takes one (unit.launch()) and it reloads after the sortie
 * cooldown, exactly like a missile silo. Sabotage freezes it.
 */
export class AirportExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(private airport: Unit) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.airport.isUnderConstruction()) return;
    if (!this.airport.isActive()) {
      this.active = false;
      return;
    }
    if (this.airport.isDisabled()) return;
    const cooldown = this.mg
      .config()
      .airportSortieCooldown(this.airport.owner());
    while (this.airport.missileTimerQueue().length > 0) {
      const frontTime = this.airport.missileTimerQueue()[0];
      if (this.mg.ticks() - frontTime < cooldown) break;
      this.airport.reloadMissile();
    }
    this.maybeDispatchAirliner(ticks);
  }

  // Each airport gets a dispatch slot every interval. A slot launches an
  // airliner with some odds, to a random airport of a player it can trade with.
  // Sorties do not use the airport's sortie slots, so civil traffic never
  // takes capacity from military flights.
  private maybeDispatchAirliner(ticks: number): void {
    // Carriers launch sorties only; airliners fly from land airports.
    if (this.airport.type() !== UnitType.Airport) return;
    const cfg = this.mg.config();
    const interval = cfg.commercialAircraftSpawnInterval();
    if (ticks % interval !== this.airport.id() % interval) return;
    const random = new PseudoRandom(ticks * 7919 + this.airport.id());
    if (!random.chance(cfg.commercialAircraftSpawnOdds())) return;
    if (
      this.mg.units(UnitType.CommercialAircraft).length >=
      cfg.commercialAircraftCap()
    ) {
      return;
    }
    const owner = this.airport.owner();
    const destinations = this.mg
      .units(UnitType.Airport)
      .filter(
        (a) =>
          a !== this.airport &&
          a.isActive() &&
          !a.isUnderConstruction() &&
          a.owner() !== owner &&
          owner.canTrade(a.owner()),
      );
    if (destinations.length === 0) return;
    const dst = destinations[random.nextInt(0, destinations.length)];
    this.mg.addExecution(new CommercialAircraftExecution(this.airport, dst));
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AirportExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      airport: w.unit(this.airport),
    });
  }

  restoreSnapshot(s: AirportState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.airport = r.unit(s.airport);
  }
}

const AirportStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  airport: zRef(),
});
type AirportState = z.infer<typeof AirportStateSchema>;

export const AirportExecutionSnapshot = execSnapshotType({
  name: "Airport",
  version: 1,
  schema: AirportStateSchema,
  cls: () => AirportExecution,
});
