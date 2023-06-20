import BlockMonitor, { BlockNotification, BlockObserver } from '../interfaces/block-monitor';
import TtlWindowMonitor, { TtlWindowObserver } from "../interfaces/ttl-window-monitor"


export default class GenericTtlWindowMonitor implements TtlWindowMonitor, BlockObserver {
  private observers = new Set<TtlWindowObserver>();
  private lastTtlWindow = -1;
  public maxOperationTtl = 0;

  addObserver(observer: TtlWindowObserver): void {
    this.observers.add(observer);
  }

  removeObserver(observer: TtlWindowObserver): void {
    this.observers.delete(observer);
  }

  private notifyObservers(ttlWindow: number, block: BlockNotification) {
    for (let observer of this.observers) {
      observer.onTtlWindow(ttlWindow, block);
    }
  }

  public calculateTtlWindow(level: number): number {
    if (this.maxOperationTtl == 0) {
      return -1;
    } else {
      return Math.floor(level / this.maxOperationTtl);
    }
  }

  onBlock(block: BlockNotification): void {
    if (this.maxOperationTtl > 0) {
      const ttlWindow = this.calculateTtlWindow(block.level);
      if (ttlWindow > this.lastTtlWindow) {
        if (this.lastTtlWindow != -1) {
          // Don't notify at start time.
          //console.debug(`New ttlWindow ${ttlWindow} started.`);
          this.notifyObservers(ttlWindow, block);
        }
        this.lastTtlWindow = ttlWindow;
      }
    }
  }

  constructor(
    private readonly maxOperationTtlPromise: Promise<number>,
    private readonly blockMonitor: BlockMonitor
  ) {
    maxOperationTtlPromise.then((maxOperationTtl) => {
      console.debug(`TtlWindows have ${maxOperationTtl} blocks.`);
      this.maxOperationTtl = maxOperationTtl;
      this.blockMonitor.addObserver(this);
    }).catch((reason) => {
      console.error(reason);
      console.error("TtlWindow monitoring failed, since number of blocks per ttlWindow could not be determined.");
    });
  }
}
