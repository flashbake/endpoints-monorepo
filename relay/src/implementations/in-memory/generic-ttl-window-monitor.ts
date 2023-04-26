import BlockMonitor, { BlockNotification, BlockObserver } from "../../interfaces/block-monitor"
import TtlWindowMonitor, { CycleObserver } from "../../interfaces/ttl-window-monitor"


export default class GenericTtlWindowMonitor implements TtlWindowMonitor, BlockObserver {
  private observers = new Set<CycleObserver>();
  private lastCycle = -1;
  public maxOperationTtl = 0;

  addObserver(observer: CycleObserver): void {
    this.observers.add(observer);
  }

  removeObserver(observer: CycleObserver): void {
    this.observers.delete(observer);
  }

  private notifyObservers(ttlWindow: number, block: BlockNotification) {
    for (let observer of this.observers) {
      observer.onTtlWindow(ttlWindow, block);
    }
  }

  private calculateCycle(level: number): number {
    return Math.floor(level / this.maxOperationTtl);
  }

  onBlock(block: BlockNotification): void {
    if (this.maxOperationTtl > 0) {
      const ttlWindow = this.calculateCycle(block.level);
      if (ttlWindow > this.lastCycle) {
        console.debug(`New ttlWindow ${ttlWindow} started.`);
        this.lastCycle = ttlWindow;
        this.notifyObservers(ttlWindow, block);
      }
    }
  }

  constructor(
    private readonly maxOperationTtlPromise: Promise<number>,
    private readonly blockMonitor: BlockMonitor
  ) {
    maxOperationTtlPromise.then((maxOperationTtl) => {
      console.debug(`Cycles have ${maxOperationTtl} blocks.`);
      this.maxOperationTtl = maxOperationTtl;
      this.blockMonitor.addObserver(this);
    }).catch((reason) => {
      console.error(reason);
      console.error("Cycle monitoring failed, since number of blocks per ttlWindow could not be determined.");
    });
  }
}
