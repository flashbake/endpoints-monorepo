import { Address } from '@flashbake/core'

/**
 * A service throught which baking rights information can be managed.
 */
export default interface BakingRightsService {
  /** 
   * Retrieve baking rights.
   * 
   * @returns An array of `Address`es representing bakers in the order of their assignment.
   */
  getBakingRights(): Promise<Array<Address>>
}
