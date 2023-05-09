import BlockMonitor, { BlockNotification, BlockObserver, BlockMap } from "../interfaces/block-monitor"
import { BlockHash } from "../types/core"
import * as http from "http";

export default class RpcBlockMonitor implements BlockMonitor {
  // chain_id (as used in RPC interface) to monitor blocks on by default
  private static DEFAULT_CHAIN_ID = "main";

  // number of connection retries to use by default
  private static DEFAULT_RETRY_ATTEMPTS = 1000;

  // number of milliseconds to wait between connection retries by default
  private static DEFAULT_RETRY_INTERVAL = 5000;

  private observers = new Set<BlockObserver>();
  private isStarted = false;

  blockHashes: BlockMap = {};

  addObserver(observer: BlockObserver): void {
    this.observers.add(observer);
  }

  removeObserver(observer: BlockObserver): void {
    this.observers.delete(observer);
  }

  getActiveHashes(): BlockHash[] {
    return Object.values(this.blockHashes).map(b => b.hash.toString())
  }

  private notifyObservers(block: BlockNotification) {
    if (this.isStarted) {
      for (const observer of this.observers) {
        observer.onBlock(block);
      }
    }
  }

  private populateHash(block: BlockNotification) {
    // Store the hash (potentially overwrite if new round)
    let level = Number(block.level);
    // We store hashes and predecessor hashes together, just like block themselves.
    // We use the recursive `handleParent` function to parse all previous hashes and
    // make sure we have an unbroken chain, every time we receive a new hash.
    // Every unknown level is fetched from RPC.
    this.blockHashes[Number(level)] = {
      hash: block.hash,
      predecessor: block.predecessor
    }
    this.handleParent(level, 240);
    // Delete expired hashes.
    Object.keys(this.blockHashes).filter(k => level - Number(k) >= 240).forEach(k => {
      delete this.blockHashes[Number(k)]
    })
  }

  private async initialPopulateHash(block: BlockNotification) {
    // Populate hashes at start.
    let level = Number(block.level);
    this.blockHashes[Number(level)] = {
      hash: block.hash,
      predecessor: block.predecessor
    }
    // Do it in parallel to speed up.
    this.handleParent(level, 30);
    this.handleParent(level - 30, 30);
    this.handleParent(level - 60, 30);
    this.handleParent(level - 90, 30);
    this.handleParent(level - 120, 30);
    this.handleParent(level - 150, 30);
    this.handleParent(level - 180, 30);
    this.handleParent(level - 210, 30);
    this.handleParent(level - 240, 30);
  }

  private handleParent(level: number, remainingTtl: number) {
    if (!(level - 1 in this.blockHashes) || this.blockHashes[level].predecessor != this.blockHashes[level - 1].hash) {
      RpcBlockMonitor.getBlockHeader(this.rpcApiUrl, level - 1).then((blockHeader) => {
        this.blockHashes[level - 1] = {
          hash: blockHeader.hash,
          predecessor: blockHeader.predecessor,
        }
        if (remainingTtl > 0) {
          this.handleParent(level - 1, remainingTtl - 1);
        }

      })
    } else {
      if (remainingTtl > 0) {
        this.handleParent(level - 1, remainingTtl - 1);
      }
    }
  }

  private static async getBlockHeader(rpcApiUrl: string,
    level: number): Promise<any> {
    return new Promise((resolve, reject) => {
      http.get(`${rpcApiUrl}/chains/main/blocks/${level}/header`, (resp) => {
        const { statusCode } = resp;
        const contentType = resp.headers['content-type'] || '';

        var error;
        if (statusCode !== 200) {
          error = new Error(`Block header request failed with status code: ${statusCode}.`);
        } else if (!/^application\/json/.test(contentType)) {
          error = new Error(`Block header request request produced unexpected response content-type ${contentType}.`);
        }
        if (error) {
          resp.resume();
          reject();
          return;
        }

        // A chunk of data has been received.
        var rawData = '';
        resp.on('data', (chunk) => { rawData += chunk; });
        resp.on('end', () => {
          try {
            const header = JSON.parse(rawData);
            resolve(header);
          } catch (e) {
            reject();
          }
        });
      }).on("error", (err) => {
        reject();
      })
    });
  }

  /**
   * Use Node RPC to monitor block production and notify observers of new blocks.
   */
  private run(retryCounter = 0) {

    http.get(`${this.rpcApiUrl}/monitor/heads/${this.chainId}`, (resp: http.IncomingMessage) => {
      {
        const { statusCode } = resp;
        const contentType = resp.headers['content-type'] || '';

        var error = '';
        if (statusCode !== 200) {
          error = `unexpected status code ${statusCode}.`;
        } else if (!/^application\/json/.test(contentType)) {
          error = `unexpected response content-type ${contentType}.`;
        }

        resp.on('data', (chunk) => {
          if (!error) {
            try {
              const block = JSON.parse(chunk) as BlockNotification;
              // console.debug(`Received block ${block.level} notification.`);
              if (!this.isStarted) {
                // All block headers in active window have been retrieved from RPC
                // at start.
                let numFetchedBlocks = Object.keys(this.blockHashes).length;
                if (numFetchedBlocks >= 240) {
                  console.log("All block headers in active window have been retrieved from RPC, starting mempool.");
                  this.isStarted = true;
                } else if (numFetchedBlocks == 0) {
                  this.initialPopulateHash(block);
                }
              }
              if (this.isStarted) {
                this.populateHash(block);
                this.notifyObservers(block);
              }
            } catch (e) {
              error = (e instanceof Error) ? e.message : 'parsing failure';
            }
          }

          if (error) {
            console.debug(`Block monitoring failure: ${error}`);
            error = '';
          }
        })

        // octez has ended the response
        resp.on('end', () => {
          // restart the monitor thread
          this.run();
        });
      }
    }).on("error", (err) => {
      console.error(`Block monitor connection error: ${err.message}`);
      if (retryCounter < this.retryAttempts) {
        ++retryCounter;
        setTimeout(() => {
          console.debug(`Block monitor connection retry \t${retryCounter}/${this.retryAttempts}`);
          this.run(retryCounter);
        }, this.retryInterval);
      } else {
        console.debug("Too many block monitor connection retries, giving up");
      }
    });
  }

  public start() {
    console.debug("Starting to monitor block production.");
    this.run();
  }

  public stop() {
    console.debug("Winding down block production monitoring.");
    this.isStarted = false;
  }

  constructor(
    private readonly rpcApiUrl: string,
    private readonly chainId: string = RpcBlockMonitor.DEFAULT_CHAIN_ID,
    private readonly retryInterval: number = RpcBlockMonitor.DEFAULT_RETRY_INTERVAL,
    private readonly retryAttempts: number = RpcBlockMonitor.DEFAULT_RETRY_ATTEMPTS
  ) {
  }
}
