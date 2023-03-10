import { Address } from '@flashbake/core'

/**
 * A service through which baking rights information can be managed.
 */
export default interface BakingRightsService {
  /** 
   * Retrieve baking rights.
   * 
   * @returns An array of `BakingAssignment`s for the relevant future
   *          blocks after `level`.
   */
  getBakingRights(level: number): Promise<BakingAssignment[]>
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
