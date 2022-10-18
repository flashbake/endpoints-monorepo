import BakingRightsService, { BakingAssignment } from "../../interfaces/baking-rights-service"
import CycleMonitor from "../../interfaces/cycle-monitor"
import * as http from "http";
import pLimit from "p-limit";

/** 
 * A baking rights service that queries an RPC endpoint for each baking rights retrieval request.
 */
export default class RpcBakingRightsService implements BakingRightsService {
  private cycle = 0;
  private maxRound = 0;

  setCycle(cycle: number) {
    this.cycle = cycle;
  }

  setMaxRound(maxRound: number) {
    this.maxRound = maxRound;
  }

  private static getStartEndLevel(cycle: number, cycleMonitor: CycleMonitor): [number, number] {
    const blocksPerCycle = cycleMonitor.blocksPerCycle;
    if (cycleMonitor.chainId == "NetXdQprcVkpaWU") {
      // tezos mainnet - blocks per cycle changed in granada
      const blocksBeforeGranada = 1589248;
      const cyclesAfterGranada = cycle - 388;
      return [blocksBeforeGranada + cyclesAfterGranada * blocksPerCycle, blocksBeforeGranada + (cyclesAfterGranada + 1) * blocksPerCycle - 1];
    } else {
      return [cycle * blocksPerCycle, (cycle + 1) * blocksPerCycle - 1];
    }
  }


  private static getBakingRights(rpcApiUrl: string, cycle: number, cycleMonitor: CycleMonitor, maxRound: number): Promise<BakingAssignment[]> {
    let bakingAssignments: Promise<BakingAssignment>[] = [];

    // Fetching baking rights for thousand of levels concurrently with a maximum request count of 20.
    const limit = pLimit(20);
    const [startLevel, endLevel] = RpcBakingRightsService.getStartEndLevel(cycle, cycleMonitor);
    for (let i = startLevel; i < endLevel; i++) {
      bakingAssignments.push(
        limit(() => RpcBakingRightsService.getBakingRightForLevel(rpcApiUrl, i, maxRound))
      )
    }
    return Promise.all(bakingAssignments)
  }

  private static getBakingRightForLevel(rpcApiUrl: string, level: number, maxRound: number): Promise<BakingAssignment> {
    return new Promise<BakingAssignment>((resolve, reject) => {
      http.get(`${rpcApiUrl}/chains/main/blocks/head/helpers/baking_rights?level=${level}&max_round=${maxRound}`, (resp) => {
        const { statusCode } = resp;
        const contentType = resp.headers['content-type'] || '';

        var error: Error;
        if (statusCode !== 200) {
          error = new Error(`Baking rights request failed with status code: ${statusCode}.`);
        } else if (!/^application\/json/.test(contentType)) {
          error = new Error(`Baking rights request produced unexpected response content-type ${contentType}.`);
        }

        // A chunk of data has been received.
        var rawData = '';
        resp.on('data', (chunk) => { rawData += chunk; });
        resp.on('end', () => {
          if (error) {
            if (rawData.length > 0) {
              error.message += ' '.concat(rawData);
            }
            reject(error.message);
            return;
          } else try {
            if (level % 100 === 0) {
              console.log(`Fetched baking right for level ${level}`);
            }
            resolve(JSON.parse(rawData)[0] as BakingAssignment);
            return;
          } catch (e) {
            reject(e);
            return;
          }
        });
      }).on("error", (err) => {
        reject("Error while querying baker rights: " + err.message);
        return;
      });
    })
  }

  /**
   * Fetch baker rights assignments from Tezos node RPC API and parse them.
   * 
   * @returns Addresses of the bakers assigned in the current cycle in the order of their assignment
   */
  public getBakingRights(): Promise<BakingAssignment[]> {
    return new Promise<BakingAssignment[]>((resolve, reject) => {
      Promise.all([
        RpcBakingRightsService.getBakingRights(this.rpcApiUrl, this.cycle, this.cycleMonitor, this.maxRound),
        RpcBakingRightsService.getBakingRights(this.rpcApiUrl, this.cycle + 1, this.cycleMonitor, this.maxRound)
      ]).then((cycleRights) => {
        resolve(cycleRights[0].concat(cycleRights[1]));
      }).catch((reason) => {
        reject(reason);
      })
    });
  }

  public constructor(private readonly rpcApiUrl: string, private readonly cycleMonitor: CycleMonitor) { }
}
