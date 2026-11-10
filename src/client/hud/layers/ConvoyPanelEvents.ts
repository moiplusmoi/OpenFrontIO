import { GameEvent } from "@openfront/shared/EventBus";

/**
 * Opens the convoy panel for the owned structure `sourceId`, or closes it
 * (`sourceId` null). The panel sends the order itself.
 */
export class ShowConvoyPanelEvent implements GameEvent {
  constructor(public readonly sourceId: number | null) {}
}
