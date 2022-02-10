import BlockMonitor, { BlockNotification, BlockObserver } from "../../interfaces/block-monitor"
import * as http from "http";

export default class RpcBlockMonitor implements BlockMonitor {
  private observers = new Set<BlockObserver>();
  private isRunning = false;

  addObserver(observer: BlockObserver): void {
    this.observers.add(observer);      
  }

  removeObserver(observer: BlockObserver): void {
    this.observers.delete(observer);
  }

  private notifyObservers(block: BlockNotification) {
    for (let observer of this.observers) {
      observer.onBlock(block);
    }
  }

  /**
   * Use Node RPC to monitor block production and notify observers of new blocks.
   */
  private run() {
    if (!this.isRunning) return;

    http.get(`${this.rpcApiUrl}/monitor/heads/${this.chainId}`, (resp: http.IncomingMessage) => {
      {
        resp.on('data', (chunk) => {
          console.debug("RpcBlockMonitor: received block notification from node RPC:");
          console.debug(chunk.toString());
          try {
            const block = JSON.parse(chunk) as BlockNotification;
            this.notifyObservers(block);
          } catch(e) {
            console.debug("RpcBlockMonitor: failed to deserialize new block notification:");
            console.debug((e instanceof Error) ? e.message : e);
          }
        })
  
        // octez has ended the response
        resp.on('end', () => {
          // restart the monitor thread
          console.debug("RpcBlockMonitor: connection ended, reopening:");
          this.run();
        });
      }
    }).on("error", (err) => {
      console.error("RpcBlockMonitor: " + err.message);
      setTimeout(() => {
        console.error("RpcBlockMonitor: retrying");
        this.run();
      }, this.retryTimeout);
    });
  }

  public start() {
    this.isRunning = true;
    this.run();
  }

  public stop() {
    this.isRunning = false;
  }

  constructor(
    private readonly rpcApiUrl: string,
    private readonly chainId: string = "main",
    private readonly retryTimeout: number = 5000
  ) {

  }
}
