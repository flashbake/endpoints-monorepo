import { BlockHash } from "../types/core"
/**
 * DTO for new block information.
 */
export interface BlockNotification {
  hash: string,
  level: number,
  proto: number,
  predecessor: string,
  timestamp: string,
  validation_pass: number,
  operations_hash: string,
  context: string,
  protocol_data: string;
}


/**
 * An interface through which blocks are delivered to observers.
 */
export interface BlockObserver {
  /** 
   * Receive notification of a new block.
   */
  onBlock(block: BlockNotification): void;
}

/**
 * A service to monitor new blocks and notify the registered blocks observers.
 */
export default interface BlockMonitor {
  /** 
   * Add a new block observer.
   */
  addObserver(observer: BlockObserver): void;

  /** 
   * Remove a previously added block observer.
   */
  removeObserver(observer: BlockObserver): void;

  /**
   * Get active block hashes
   */
  getActiveHashes(): string[];
}

export interface BlockWithParent {
  hash: BlockHash;
  predecessor: BlockHash;
}

export type BlockMap = { [key: number]: BlockWithParent };
