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
  getBakingRights(): Promise<BakingAssignment[]>
}

/** 
 * A baking assignment.
 */
export interface BakingAssignment {
  level: number;
  delegate: Address;
  round: number;
  estimated_time: string;
}
