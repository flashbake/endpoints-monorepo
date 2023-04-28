import { BlockNotification } from "./block-monitor";


/**
 * An interface through which new ttlWindow notifications are delivered to observers.
 */
export interface TtlWindowObserver {
  /** 
   * Receive notification of a new ttlWindow with the first block of the new ttlWindow.
   */
  onTtlWindow(ttlWindow: number, block: BlockNotification): void;
}

/**
 * A service to monitor new ttlWindows and notify the registered observers.
 */
export default interface TtlWindowMonitor {
  maxOperationTtl: number;
  /** 
   * Add a new ttlWindow observer.
   */
  addObserver(observer: TtlWindowObserver): void;

  /** 
   * Remove a previously added ttlWindow observer.
   */
  removeObserver(observer: TtlWindowObserver): void;
  calculateTtlWindow(level: number): number;
}


