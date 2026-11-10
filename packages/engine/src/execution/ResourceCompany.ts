import {
  RESOURCE_TYPES,
  ResourceType,
  Structures,
} from "@openfront/engine-api/game/GameTypes";
import { Game, Player, Unit } from "../game/Game";
import {
  convoyModeBetween,
  SendConvoyExecution,
} from "./ResourceConvoyExecution";

/** The trade companies look at their structures this often (ticks). */
export const COMPANY_INTERVAL_TICKS = 100;
/** A structure holding more than this of a resource has a surplus to ship. */
export const SURPLUS_ABOVE = 60;
/** A destination holding less than this of a resource needs it. */
export const NEED_BELOW = 40;
/** How much one automatic convoy carries. */
export const COMPANY_LOAD = 20;
/** At most this many convoys per company run, so the trade stays readable. */
const MAX_CONVOYS_PER_RUN = 4;

/**
 * The trade companies. Nobody orders a shipment by hand: every
 * COMPANY_INTERVAL_TICKS a player's structures are checked, and a surplus goes
 * to a structure that needs it. Its own structures come first; failing that, a
 * neighbour that needs it and may trade with the player (the neighbour pays on
 * arrival, through the convoy).
 */
export function runResourceCompanies(mg: Game, player: Player): void {
  if (mg.ticks() % COMPANY_INTERVAL_TICKS !== 0) return;
  let sent = 0;
  for (const src of structuresOf(player)) {
    if (sent >= MAX_CONVOYS_PER_RUN) return;
    if (!src.isActive() || src.isUnderConstruction()) continue;
    for (const resource of RESOURCE_TYPES) {
      if (sent >= MAX_CONVOYS_PER_RUN) return;
      if (src.stock(resource) <= SURPLUS_ABOVE) continue;
      const dst = findDestination(mg, player, src, resource);
      if (dst === null) continue;
      mg.addExecution(
        new SendConvoyExecution(
          player,
          src.id(),
          dst.unit.id(),
          resource,
          COMPANY_LOAD,
          dst.mode,
        ),
      );
      sent++;
    }
  }
}

/** Every structure a player owns, alive or under construction. */
function structuresOf(player: Player): Unit[] {
  return player.units().filter((u) => Structures.has(u.type()));
}

/**
 * The nearest structure that needs `resource` and has a route from `src`:
 * the player's own first, then a trading neighbour's.
 */
function findDestination(
  mg: Game,
  player: Player,
  src: Unit,
  resource: ResourceType,
): {
  unit: Unit;
  mode: NonNullable<ReturnType<typeof convoyModeBetween>>;
} | null {
  const own = nearestNeeding(mg, src, resource, structuresOf(player));
  if (own !== null) return own;
  for (const other of mg.players()) {
    if (other === player || !player.canTrade(other)) continue;
    const found = nearestNeeding(mg, src, resource, structuresOf(other));
    if (found !== null) return found;
  }
  return null;
}

function nearestNeeding(
  mg: Game,
  src: Unit,
  resource: ResourceType,
  candidates: Unit[],
): {
  unit: Unit;
  mode: NonNullable<ReturnType<typeof convoyModeBetween>>;
} | null {
  const needing = candidates
    .filter(
      (u) =>
        u !== src &&
        u.isActive() &&
        !u.isUnderConstruction() &&
        Structures.has(u.type()) &&
        u.stock(resource) < NEED_BELOW,
    )
    .sort(
      (a, b) =>
        mg.manhattanDist(src.tile(), a.tile()) -
        mg.manhattanDist(src.tile(), b.tile()),
    );
  for (const unit of needing) {
    const mode = convoyModeBetween(mg, src, unit);
    if (mode !== null) return { unit, mode };
  }
  return null;
}
