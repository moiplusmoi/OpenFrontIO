import {
  Difficulty,
  ResourceType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { Game, Player } from "../../game/Game";
import { ConstructionExecution } from "../ConstructionExecution";
import { SendConvoyExecution } from "../ResourceConvoyExecution";

/** A city below this much food asks for a delivery. */
const HUNGRY_BELOW = 40;
/** A delivery is this many units. */
const DELIVERY = 20;

/**
 * A nation's resource economy. It works out no state of its own: every
 * decision reads the current game, so the behavior is built on demand.
 *
 * It builds mines on deposits it owns, and feeds its hungry cities by rail
 * from its food mines. Easy nations do neither.
 */
export class NationResourceBehavior {
  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
  ) {}

  maybeAct(): void {
    const { difficulty } = this.game.config().gameConfig();
    if (difficulty === Difficulty.Easy) return;
    this.maybeBuildMine();
    this.maybeFeedCity();
  }

  private maybeBuildMine(): void {
    if (this.game.config().isUnitDisabled(UnitType.Mine)) return;
    if (this.random.nextInt(0, 100) >= 10) return;
    const cost = this.game.unitInfo(UnitType.Mine).cost(this.game, this.player);
    if (this.player.gold() < cost * 2n) return;

    // Deposits in the game's own order, so every client picks the same one.
    const free: number[] = [];
    for (const tile of this.game.deposits().keys()) {
      if (this.player.canBuild(UnitType.Mine, tile) !== false) free.push(tile);
    }
    if (free.length === 0) return;
    const tile = free[this.random.nextInt(0, free.length)];
    this.game.addExecution(
      new ConstructionExecution(this.player, UnitType.Mine, tile),
    );
  }

  private maybeFeedCity(): void {
    const city = this.player
      .units(UnitType.City)
      .find(
        (c) => c.hasTrainStation() && c.stock(ResourceType.Food) < HUNGRY_BELOW,
      );
    if (city === undefined) return;
    const mine = this.player
      .units(UnitType.Mine)
      .find(
        (m) => m.hasTrainStation() && m.stock(ResourceType.Food) >= DELIVERY,
      );
    if (mine === undefined) return;
    this.game.addExecution(
      new SendConvoyExecution(
        this.player,
        mine.id(),
        city.id(),
        ResourceType.Food,
        DELIVERY,
        "rail",
      ),
    );
  }
}
