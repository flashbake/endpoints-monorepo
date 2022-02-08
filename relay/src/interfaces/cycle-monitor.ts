import { BlockNotification } from "./block-monitor";


/**
 * An interface through which new cycle notifications are delivered to observers.
 */
export interface CycleObserver {
  /** 
   * Receive notification of a new cycle with the first block of the new cycle.
   */
  onCycle(block: BlockNotification): void;
}

/**
 * A service to monitor new cycles and notify the registered observers.
 */
export default interface CycleMonitor {
  /** 
   * Add a new cycle observer.
   */
  addObserver(observer: CycleObserver): void;

  /** 
   * Remove a previously added cycle observer.
   */
   removeObserver(observer: CycleObserver): void;
}


