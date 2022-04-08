import BlockMonitor, { BlockNotification, BlockObserver } from "../../interfaces/block-monitor"
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

  addObserver(observer: BlockObserver): void {
    this.observers.add(observer);      
  }

  removeObserver(observer: BlockObserver): void {
    this.observers.delete(observer);
  }

  private notifyObservers(block: BlockNotification) {
    if (this.isStarted) {
      for (const observer of this.observers) {
        observer.onBlock(block);
      }
    }
  }

  /**
   * Use Node RPC to monitor block production and notify observers of new blocks.
   */
  private run(retryCounter = 0) {
    if (!this.isStarted) return;

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
              console.debug(`Received block ${block.level} notification.`);
              this.notifyObservers(block);
            } catch(e) {
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
    this.isStarted = true;
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
