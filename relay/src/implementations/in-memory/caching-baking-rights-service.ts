import TtlWindowMonitor, { TtlWindowObserver } from "../../interfaces/ttl-window-monitor";
import BakingRightsService, { BakingAssignment } from "../../interfaces/baking-rights-service";
import { BlockNotification } from "../../interfaces/block-monitor";
import RpcBakingRightsService from "../../implementations/rpc/rpc-baking-rights-service";
import { RegistryService } from '../../interfaces/registry-service';
import OnChainRegistryService from "../../implementations/taquito/on-chain-registry-service";

/**
 * A baking rights service implementation which monitors blocks as they are produced and
 * maintains an in-memory cache of baking rights assignments for the current baking ttlWindow.
 */
export default class CachingBakingRightsService implements BakingRightsService, TtlWindowObserver {
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
    let newBakingRights = this.innerBakingRightsService.getBakingRights();
    newBakingRights.then(brs => {
      brs.forEach(br => {
        br.endpoint = this.registry.getEndpoint(br.delegate);
      })
    })
    this.lastBakingRights = newBakingRights;
    console.debug(`Baking right assignments for ttlWindow ${ttlWindow} refreshed.`);
  }

  public constructor(
    private readonly rpcApiUrl: string,
    private readonly ttlWindowMonitor: TtlWindowMonitor,
    private maxRound = 0,
    private readonly registry: RegistryService
  ) {
    ttlWindowMonitor.addObserver(this);
    this.innerBakingRightsService = new RpcBakingRightsService(rpcApiUrl, ttlWindowMonitor);
    this.innerBakingRightsService.setMaxRound(maxRound);
  };
}
