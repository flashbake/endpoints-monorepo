import CycleMonitor, { CycleObserver } from "../../interfaces/cycle-monitor";
import BakingRightsService, { BakingAssignment } from "../../interfaces/baking-rights-service";
import { BlockNotification } from "../../interfaces/block-monitor";

/**
 * A baking rights service implementation which monitors blocks as they are produced and
 * maintains an in-memory cache of baking rights assignments for the current baking cycle.
 */
export default class CachingBakingRightsService implements BakingRightsService, CycleObserver {
  private lastBakingRights: Promise<BakingAssignment[]> = new Promise((resolve) => {
    resolve([]);
  });

  /**
   * Provide current cycle's baker rights assignments from cache.
   * 
   * @returns Addresses of the bakers assigned in the current cycle in the order of their assignment
   */
  public getBakingRights(): Promise<BakingAssignment[]> {
    return this.lastBakingRights;
  }

  onCycle(block: BlockNotification) {
    console.debug("CachingBakingRightsService: cycle notification received, updating baking rights.");
    this.lastBakingRights = this.innerBakingRightsService.getBakingRights();
  }

  public constructor(
      private readonly innerBakingRightsService: BakingRightsService,
      private readonly cycleMonitor: CycleMonitor,
  ) {
    cycleMonitor.addObserver(this);
  };
}