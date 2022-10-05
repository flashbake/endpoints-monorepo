import BakingRightsService, { BakingAssignment } from "../../interfaces/baking-rights-service"
import * as http from "http";

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

  private static getBakingRights(rpcApiUrl: string, cycle: number, maxRound: number): Promise<BakingAssignment[]> {
    return new Promise<BakingAssignment[]>((resolve, reject) => {
      http.get(`${rpcApiUrl}/chains/main/blocks/head/helpers/baking_rights?cycle=${cycle}&max_round=${maxRound}`, { timeout: 180000 }, (resp) => {
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
            resolve(JSON.parse(rawData) as BakingAssignment[]);
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
        RpcBakingRightsService.getBakingRights(this.rpcApiUrl, this.cycle, this.maxRound),
        RpcBakingRightsService.getBakingRights(this.rpcApiUrl, this.cycle + 1, this.maxRound)
      ]).then((cycleRights) => {
        resolve(cycleRights[0].concat(cycleRights[1]));
      }).catch((reason) => {
        reject(reason);
      })
    });
  }

  public constructor(private readonly rpcApiUrl: string) { }
}
