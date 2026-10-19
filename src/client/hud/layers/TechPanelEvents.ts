import { TechId } from "@openfront/engine-api/game/GameTypes";
import { GameEvent } from "@openfront/shared/EventBus";

/**
 * Opens (or closes) the technologies panel. `highlight` names a tech to
 * scroll to and flash — a locked build item taps through to it.
 *
 * Lives apart from TechPanel.ts so menu code (RadialMenuElements, the
 * hotbar) can emit it without pulling the Lit panel into its module graph.
 */
export class ShowTechPanelEvent implements GameEvent {
  constructor(
    public readonly visible: boolean = true,
    public readonly highlight: TechId | null = null,
  ) {}
}
