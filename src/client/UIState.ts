import { PlayerBuildableUnitType } from "@openfront/engine-api/game/GameTypes";

export interface UIState {
  attackRatio: number;
  ghostStructure: PlayerBuildableUnitType | null;
  /** Batch placement: the ghost stays armed after each warship (keybind `batchPlace`). */
  batchPlace: boolean;
  /** GalloFront: tiles a right-click lot would build on, for the preview dots. */
  batchPreview?: readonly number[];
  rocketDirectionUp: boolean;
  upgradeMultiplier: number;
}
