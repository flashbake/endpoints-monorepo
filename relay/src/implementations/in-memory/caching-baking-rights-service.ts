import TtlWindowMonitor, { TtlWindowObserver } from "../../interfaces/ttl-window-monitor";
import BakingRightsService, { BakingAssignment } from "../../interfaces/baking-rights-service";
import { BlockNotification } from "../../interfaces/block-monitor";
import { RegistryService } from '../../interfaces/registry-service';
import OnChainRegistryService from "../../implementations/taquito/on-chain-registry-service";
import * as http from "http";
import pLimit from "p-limit";

/**
 * A baking rights service implementation which monitors blocks as they are produced and
 * maintains an in-memory cache of baking rights assignments for the current baking ttlWindow.
 */
export default class CachingBakingRightsService implements BakingRightsService, TtlWindowObserver {
  private lastBakingRights: BakingAssignment[];
  private ttlWindow = 0;


  private static getStartEndLevel(ttlWindow: number, ttlWindowMonitor: TtlWindowMonitor): [number, number] {
    const maxOperationTtl = ttlWindowMonitor.maxOperationTtl;
    return [ttlWindow * maxOperationTtl, (ttlWindow + 1) * maxOperationTtl - 1];
  }

  private static innerGetBakingRights(rpcApiUrl: string, ttlWindow: number, ttlWindowMonitor: TtlWindowMonitor, maxRound: number): Promise<BakingAssignment[]> {
    let bakingAssignments: Promise<BakingAssignment>[] = [];

    // Fetching baking rights for tens of levels concurrently with a maximum request count of 20.
    const limit = pLimit(20);
    const [startLevel, endLevel] = this.getStartEndLevel(ttlWindow, ttlWindowMonitor);
    for (let i = startLevel; i < endLevel; i++) {
      bakingAssignments.push(
        limit(() => this.getBakingRightForLevel(rpcApiUrl, i, maxRound))
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
   * @returns Addresses of the bakers assigned in the current ttlWindow in the order of their assignment
   */
  public getBakingRights(): BakingAssignment[] {
    return this.lastBakingRights;
  }

  onTtlWindow(ttlWindow: number, block: BlockNotification) {
    console.debug("New ttlWindow started, refreshing baking rights assignments.");
    this.ttlWindow = ttlWindow;
    // don't query the same baker twice - store lists of unique bakers in ttl window
    let uniqueBakers: string[] = [];
    let uniqueEndpoints: Promise<string | undefined>[] = [];
    CachingBakingRightsService.innerGetBakingRights(this.rpcApiUrl, ttlWindow, this.ttlWindowMonitor, this.maxRound).then(brs => {
      brs.forEach(br => {
        if (uniqueBakers.indexOf(br.delegate) === -1) {
          uniqueBakers.push(br.delegate);
          uniqueEndpoints.push(this.registry.getEndpoint(br.delegate));
        }
      })
      console.log(`Found ${uniqueBakers.length} unique bakers in next ttlWindow`)
      Promise.all(uniqueEndpoints).then(uniqueEndpoints => {
        brs.forEach(br => {
          br.endpoint = uniqueEndpoints[uniqueBakers.indexOf(br.delegate)];
        });
        this.lastBakingRights = brs;
      })
    });
  }

  public constructor(
    private readonly rpcApiUrl: string,
    private readonly ttlWindowMonitor: TtlWindowMonitor,
    private maxRound = 0,
    private readonly registry: RegistryService
  ) {
    ttlWindowMonitor.addObserver(this);
    this.maxRound = maxRound;
    this.lastBakingRights = [];
  };
}
