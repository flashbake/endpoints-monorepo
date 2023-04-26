import TtlWindowMonitor, { CycleObserver } from "../../interfaces/ttl-window-monitor";
import BakingRightsService, { BakingAssignment } from "../../interfaces/baking-rights-service";
import { BlockNotification } from "../../interfaces/block-monitor";
import RpcBakingRightsService from "../../implementations/rpc/rpc-baking-rights-service";

/**
 * A baking rights service implementation which monitors blocks as they are produced and
 * maintains an in-memory cache of baking rights assignments for the current baking ttlWindow.
 */
export default class CachingBakingRightsService implements BakingRightsService, CycleObserver {
  private innerBakingRightsService: RpcBakingRightsService;

  private lastBakingRights: Promise<BakingAssignment[]> = new Promise((resolve) => {
    resolve([]);
  });

  /**
   * Provide current ttlWindow's baker rights assignments from cache.
   * 
   * @returns Addresses of the bakers assigned in the current ttlWindow in the order of their assignment
   */
  public getBakingRights(): Promise<BakingAssignment[]> {
    return this.lastBakingRights;
  }

  onTtlWindow(ttlWindow: number, block: BlockNotification) {
    console.debug("New ttlWindow started, refreshing baking rights assignments.");
    this.innerBakingRightsService.setTtlWindow(ttlWindow);
    this.lastBakingRights = this.innerBakingRightsService.getBakingRights();
    console.debug(`Baking right assignments for ttlWindow ${ttlWindow} refreshed.`);
  }

  public constructor(
    private readonly rpcApiUrl: string,
    private readonly ttlWindowMonitor: TtlWindowMonitor,
    private maxRound = 0
  ) {
    ttlWindowMonitor.addObserver(this);
    this.innerBakingRightsService = new RpcBakingRightsService(rpcApiUrl, ttlWindowMonitor);
    this.innerBakingRightsService.setMaxRound(maxRound);
  };
}
