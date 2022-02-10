import BlockMonitor, { BlockNotification, BlockObserver } from "../../interfaces/block-monitor"
import CycleMonitor, { CycleObserver } from "../../interfaces/cycle-monitor"


export default class GenericCycleMonitor implements CycleMonitor, BlockObserver {
  private observers = new Set<CycleObserver>();
  private lastCycle = -1;

  addObserver(observer: CycleObserver): void {
    this.observers.add(observer);      
  }

  removeObserver(observer: CycleObserver): void {
    this.observers.delete(observer);
  }

  private notifyObservers(block: BlockNotification) {
    for (let observer of this.observers) {
      observer.onCycle(block);
    }
  }

  onBlock(block: BlockNotification): void {
    console.debug(`GenericCycleMonitor: new block notification received, level=${block.level}`);

    // alternatively: cycle = (block.level - block.level % this.blocksPerCycle) / this.blocksPerCycle
    const cycle = Math.floor(block.level / this.blocksPerCycle);
    if (cycle > this.lastCycle) {
      console.debug(`GenericCycleMonitor: new cycle detected ${cycle}>${this.lastCycle}`);
      this.lastCycle = cycle;
      this.notifyObservers(block);
    }
  }
  
  constructor(
    private readonly blockMonitor: BlockMonitor,
    private readonly blocksPerCycle: number
  ) {
    this.blockMonitor.addObserver(this);
  }
}
