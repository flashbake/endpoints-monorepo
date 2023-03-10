import CycleMonitor, { CycleObserver } from "../../interfaces/cycle-monitor";
import BakingRightsService, { BakingAssignment } from "../../interfaces/baking-rights-service";
import { BlockNotification } from "../../interfaces/block-monitor";
import RpcBakingRightsService from "../../implementations/rpc/rpc-baking-rights-service";
import { forEach } from "lodash";

/**
 * A baking rights service implementation which monitors blocks as they are produced and
 * maintains an in-memory cache of baking rights assignments for the current baking cycle.
 */
export default class CachingBakingRightsService implements BakingRightsService {
  private innerBakingRightsService: RpcBakingRightsService;

  private bakingRightsPerLevel: Map<number, Promise<BakingAssignment[]>> = new Map();

  /**
   * Provide future baker rights assignments from cache.
   * 
   * @returns Addresses of the bakers assigned in the next blocks in the order of their assignment
   */
  public getBakingRights(level: number): Promise<BakingAssignment[]> {
    return new Promise<BakingAssignment[]>(async (resolve, reject) => {
      let rights: BakingAssignment[] = [];
      for (let i = 0; i < 128; i++) {
        if ((level + i) in this.bakingRightsPerLevel) {
          rights.push(this.bakingRightsPerLevel.get(i))
        } else {
          rights.push(this.innerBakingRightsService.getBakingRights(i))
        }
      }
    })
  }

  public constructor(
    private readonly rpcApiUrl: string,
    private maxRound = 0
  ) {
    this.innerBakingRightsService = new RpcBakingRightsService(rpcApiUrl);
    this.innerBakingRightsService.setMaxRound(maxRound);
  };
}
