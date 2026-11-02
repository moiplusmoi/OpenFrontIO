import {
  TECH_TREE,
  TechId,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { translateText } from "../../Utils";

/** The slices of Config / PlayerView the lock check reads (stubs in tests may lack them). */
type ConfigLike = {
  unitRequiredTech?: (type: UnitType) => TechId | null;
  unitRequiredEra?: (type: UnitType) => number;
  eraOf?: (player: { hasTech(id: TechId): boolean }) => number;
};
type PlayerLike = { hasTech?: (id: TechId) => boolean } | null | undefined;

/**
 * GalloFront: the technology `player` still needs before `unit` can be
 * built, or null when the unit is open to them (or when the engine does
 * not gate it). Always read from `config.unitRequiredTech` so the menus
 * follow the engine's rules rather than a hard-coded id.
 */
export function missingTech(
  config: ConfigLike | null | undefined,
  player: PlayerLike,
  unit: UnitType,
): TechId | null {
  if (typeof config?.unitRequiredTech !== "function") return null;
  if (typeof player?.hasTech !== "function") return null;
  const owns = (id: TechId) => player.hasTech!(id);
  const required = config.unitRequiredTech(unit);
  if (required !== null && !owns(required)) return required;
  // GalloFront eras: a unit can also wait for the era. The way on is the next
  // technology not yet owned, so tapping the lock opens the panel to earn it.
  if (
    typeof config.eraOf === "function" &&
    typeof config.unitRequiredEra === "function" &&
    config.eraOf({ hasTech: owns }) < config.unitRequiredEra(unit)
  ) {
    return TECH_TREE.find((t) => !owns(t.id))?.id ?? null;
  }
  return null;
}

/** Localized name of a technology. */
export function techName(id: TechId): string {
  return translateText(`tech.${id}.name`);
}

/** "🔒 Requires: <tech>" for a locked build item. */
export function requiresTechLabel(id: TechId): string {
  return translateText("build_menu.requires_tech", { tech: techName(id) });
}

/** The `unit_type.*` translation key of a unit type ("Air Transport" → "air_transport"). */
export function unitTypeKey(unit: UnitType): string {
  return `unit_type.${unit.toLowerCase().replace(/\s+/g, "_")}`;
}

/** Every unit type a technology unlocks, in enum order. */
export function unitsUnlockedBy(
  config: ConfigLike | null | undefined,
  tech: TechId,
): UnitType[] {
  if (typeof config?.unitRequiredTech !== "function") return [];
  return Object.values(UnitType).filter(
    (unit) => config.unitRequiredTech!(unit) === tech,
  );
}
