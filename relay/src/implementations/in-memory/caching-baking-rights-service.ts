import TtlWindowMonitor, { TtlWindowObserver } from "../../interfaces/ttl-window-monitor";
import BakingRightsService, { BakingAssignment, BakingMap } from "../../interfaces/baking-rights-service";
import BlockMonitor, { BlockNotification } from "../../interfaces/block-monitor";
import { RegistryService } from '../../interfaces/registry-service';
import * as http from "http";
import pLimit from "p-limit";

/**
 * A baking rights service implementation which monitors blocks as they are produced and
 * maintains an in-memory cache of baking rights assignments for the current baking ttlWindow.
 */

export default class CachingBakingRightsService implements BakingRightsService, TtlWindowObserver {
  private bakingRights: BakingMap;
  private ttlWindow = 0;


  private static getStartEndLevel(ttlWindow: number, ttlWindowMonitor: TtlWindowMonitor): [number, number] {
    const maxOperationTtl = ttlWindowMonitor.maxOperationTtl;
    let levelStart = ttlWindow * maxOperationTtl;
    let levelEnd = (ttlWindow + 1) * maxOperationTtl - 1;
    console.log(`ttlWindow ${ttlWindow} starts at ${levelStart}, ends at ${levelEnd}.`);
    return [levelStart, levelEnd];
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
  public getBakingRights(level: number): BakingMap {
    const result: BakingMap = {};
    for (const l in this.bakingRights) {
      if (Number(l) >= level && Number(l) < level + this.ttlWindowMonitor.maxOperationTtl) {
        result[l] = this.bakingRights[l]
      }
    }
    return result;
  }

  fetchTtlWindowAssignments(ttlWindow: number) {
    console.debug(`Fetching baking rights assignments for ttlWindow ${ttlWindow}.`);
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
      console.log(`Found ${uniqueBakers.length} unique bakers in ttlWindow ${ttlWindow}, querying Flashbake registry.`)
      Promise.all(uniqueEndpoints).then(uniqueEndpoints => {
        brs.forEach(br => {
          br.endpoint = uniqueEndpoints[uniqueBakers.indexOf(br.delegate)];
          this.bakingRights[br.level] = br;
        });
        console.log(`Registry queried for ttlWindow ${ttlWindow}, found ${uniqueEndpoints.filter(x => x).length} flashbakers.`)
      })
    });
  }

  onTtlWindow(ttlWindow: number, block: BlockNotification): void {
    //We ensure to have at least 2 ttl windows of assignments in cache.
    this.fetchTtlWindowAssignments(ttlWindow + 2);
  }

  onBlock(block: BlockNotification): void {
    if (!(block.level in this.bakingRights)) {
      console.log("Fetching assignments at relay start.");
      let ttlWindow = this.ttlWindowMonitor.calculateTtlWindow(block.level)
      this.fetchTtlWindowAssignments(ttlWindow);
      this.fetchTtlWindowAssignments(ttlWindow + 1);
      this.fetchTtlWindowAssignments(ttlWindow + 2);
    }
  }

  public constructor(
    private readonly rpcApiUrl: string,
    private readonly ttlWindowMonitor: TtlWindowMonitor,
    private readonly blockMonitor: BlockMonitor,
    private maxRound = 0,
    private readonly registry: RegistryService
  ) {
    ttlWindowMonitor.addObserver(this);
    blockMonitor.addObserver(this);
    this.maxRound = maxRound;
    this.bakingRights = {};
  };
}
