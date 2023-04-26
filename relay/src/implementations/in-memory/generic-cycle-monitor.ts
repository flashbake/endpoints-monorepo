import BlockMonitor, { BlockNotification, BlockObserver } from "../../interfaces/block-monitor"
import CycleMonitor, { CycleObserver } from "../../interfaces/cycle-monitor"


export default class GenericCycleMonitor implements CycleMonitor, BlockObserver {
  private observers = new Set<CycleObserver>();
  private lastCycle = -1;
  public blocksPerCycle = 0;

  addObserver(observer: CycleObserver): void {
    this.observers.add(observer);
  }

  removeObserver(observer: CycleObserver): void {
    this.observers.delete(observer);
  }

  private notifyObservers(cycle: number, block: BlockNotification) {
    for (let observer of this.observers) {
      observer.onCycle(cycle, block);
    }
  }

  private calculateCycle(level: number): number {
    return Math.floor(level / this.blocksPerCycle);
  }

  onBlock(block: BlockNotification): void {
    if (this.blocksPerCycle > 0) {
      const cycle = this.calculateCycle(block.level);
      if (cycle > this.lastCycle) {
        console.debug(`New cycle ${cycle} started.`);
        this.lastCycle = cycle;
        this.notifyObservers(cycle, block);
      }
    }
  }

  constructor(
    private readonly blocksPerCyclePromise: Promise<number>,
    private readonly blockMonitor: BlockMonitor
  ) {
    blocksPerCyclePromise.then((blocksPerCycle) => {
      console.debug(`Cycles have ${blocksPerCycle} blocks.`);
      this.blocksPerCycle = blocksPerCycle;
      this.blockMonitor.addObserver(this);
    }).catch((reason) => {
      console.error(reason);
      console.error("Cycle monitoring failed, since number of blocks per cycle could not be determined.");
    });
  }
}
