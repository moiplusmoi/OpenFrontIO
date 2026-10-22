import {
  SurfaceCombatants,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { Game, Player, Unit } from "./Game";

/**
 * Whether `viewer`'s side can see `sub`. Friends always see each other's
 * submarines; an enemy sees one only while a surface ship or port of the
 * viewer's side is within the sonar range (Manhattan distance).
 *
 * The client mirrors this rule in FleetLayer; keep the two in step.
 */
export function isSubmarineDetectedBy(
  sub: Unit,
  viewer: Player,
  mg: Game,
): boolean {
  if (sub.owner() === viewer || viewer.isFriendly(sub.owner())) return true;
  const range = mg.config().submarineDetectionRange();
  const tile = sub.tile();
  for (const unit of mg.units([...SurfaceCombatants, UnitType.Port])) {
    if (unit.owner() !== viewer && !viewer.isFriendly(unit.owner())) continue;
    if (mg.manhattanDist(tile, unit.tile()) <= range) return true;
  }
  return false;
}
