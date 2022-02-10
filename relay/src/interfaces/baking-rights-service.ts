import { Address } from '@flashbake/core'

/**
 * A service through which baking rights information can be managed.
 */
export default interface BakingRightsService {
  /** 
   * Retrieve baking rights.
   * 
   * @returns An array of `BakingAssignment`s for a single baking cycle.
   */
  getBakingRights(maxPriority: number): Promise<BakingAssignment[]>
}

/** 
 * A baking assignment.
 */
export interface BakingAssignment {
  level: number;
  delegate: Address;
  priority: number;
  estimated_time: string;
}
