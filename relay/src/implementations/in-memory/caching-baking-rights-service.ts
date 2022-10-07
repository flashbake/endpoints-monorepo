import CycleMonitor, { CycleObserver } from "../../interfaces/cycle-monitor";
import BakingRightsService, { BakingAssignment } from "../../interfaces/baking-rights-service";
import { BlockNotification } from "../../interfaces/block-monitor";
import RpcBakingRightsService from "../../implementations/rpc/rpc-baking-rights-service";

/**
 * A baking rights service implementation which monitors blocks as they are produced and
 * maintains an in-memory cache of baking rights assignments for the current baking cycle.
 */
export default class CachingBakingRightsService implements BakingRightsService, CycleObserver {
  private innerBakingRightsService: RpcBakingRightsService;

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

  onCycle(cycle: number, block: BlockNotification) {
    console.debug("New cycle started, refreshing baking rights assignments.");
    this.innerBakingRightsService.setCycle(cycle);
    this.lastBakingRights = this.innerBakingRightsService.getBakingRights();
    console.debug(`Baking right assignments for cycle ${cycle} refreshed.`);
  }

  public constructor(
    private readonly rpcApiUrl: string,
    private readonly cycleMonitor: CycleMonitor,
    private maxRound = 0
  ) {
    cycleMonitor.addObserver(this);
    this.innerBakingRightsService = new RpcBakingRightsService(rpcApiUrl, cycleMonitor);
    this.innerBakingRightsService.setMaxRound(maxRound);
  };
}
