import BlockMonitor, { BlockNotification, BlockObserver } from "../../interfaces/block-monitor"
import CycleMonitor, { CycleObserver } from "../../interfaces/cycle-monitor"
import RpcBlockMonitor from "../../implementations/rpc/rpc-block-monitor";
import ConstantsUtil from "implementations/rpc/rpc-constants";


export default class GenericCycleMonitor implements CycleMonitor, BlockObserver {
  private observers = new Set<CycleObserver>();
  private lastCycle = -1;
  private blocksPerCycle = 0;
  private chainId = "main";
  private readonly blocksBeforeGranada = 1589248;
  private readonly cyclesBeforeGranada = 388;

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
    if (this.chainId == "NetXdQprcVkpaWU") {
      // tezos mainnet - blocks per cycle changed in granada
      return this.cyclesBeforeGranada + Math.floor((level - this.blocksBeforeGranada) / this.blocksPerCycle);
    } else {
      return Math.floor(level / this.blocksPerCycle);
    }
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
    private readonly chainIdPromise: Promise<string>,
    private readonly blockMonitor: BlockMonitor
  ) {
    Promise.all([blocksPerCyclePromise, chainIdPromise]).then(([blocksPerCycle, chainId]) => {
      console.debug(`Cycles have ${blocksPerCycle} blocks.`);
      console.debug(`Chain id is ${chainId}.`);
      this.blocksPerCycle = blocksPerCycle;
      this.chainId = chainId;
      this.blockMonitor.addObserver(this);
    }).catch((reason) => {
      console.error(reason);
      console.error("Cycle monitoring failed, since number of blocks per cycle could not be determined.");
    });
  }
}
