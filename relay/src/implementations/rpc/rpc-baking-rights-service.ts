import BakingRightsService, { BakingAssignment } from "../../interfaces/baking-rights-service"
import * as http from "http";

/** 
 * A baking rights service that queries an RPC endpoint for each baking rights retrieval request.
 */
export default class RpcBakingRightsService implements BakingRightsService {
  /**
   * Fetch baker rights assignments from Tezos node RPC API and parse them.
   * 
   * @returns Addresses of the bakers assigned in the current cycle in the order of their assignment
   */
   public getBakingRights(maxPriority = 0): Promise<BakingAssignment[]> {
    return new Promise<BakingAssignment[]>((resolve, reject) => {  
      http.get(`${this.rpcApiUrl}/chains/main/blocks/head/helpers/baking_rights?max_priority=${maxPriority}`, (resp) => {
        const { statusCode } = resp;
        const contentType = resp.headers['content-type'] || '';

        var error;
        if (statusCode !== 200) {
          error = new Error(`Baking rights request failed with status code: ${statusCode}.`);
        } else if (!/^application\/json/.test(contentType)) {
          error = new Error(`Baking rights request produced unexpected response content-type ${contentType}.`);
        }
        if (error) {
          resp.resume();
          reject(error.message);
          return;
        }

        // A chunk of data has been received.
        var rawData = '';
        resp.on('data', (chunk) => { rawData += chunk; });
        resp.on('end', () => {
          try {
            resolve(JSON.parse(rawData) as BakingAssignment[]);
          } catch (e) {
            if (typeof e === "string") {
              reject(e);
            } else if (e instanceof Error) {
              reject(e.message);
            }
          }
        });
        }).on("error", (err) => {
          reject("Error while querying baker rights: " + err.message);
        });
    })
  }

  public constructor(private readonly rpcApiUrl: string) {};
}