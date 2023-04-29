import { Address } from '@flashbake/core'

/**
 * A service through which baking rights information can be managed.
 */
export default interface BakingRightsService {
  /** 
   * Retrieve baking rights.
   * 
   * @returns Baking Right of next flashbaker in the baking level's ttlWindow.
   */
  getNextFlashbaker(level: number): BakingAssignment | undefined;
}

/** 
 * A baking assignment.
 */
export interface BakingAssignment {
  level: number;
  delegate: Address;
  round: number;
  estimated_time: string;
  endpoint: string | undefined;
}

export type BakingMap = { [key: number]: BakingAssignment };
