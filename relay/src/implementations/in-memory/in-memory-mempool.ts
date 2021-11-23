import Mempool from "../../interfaces/mempool"
import { Bundle, BundleUtils } from "@flashbake/core"
import _ from 'lodash'

/** 
 * A Mempool that exists in memory. 
 *
 * This implementation has minimal dependencies and logic, however it is volatile and will not persist data between 
 * runs. 
 */
export default class InMemoryMempool implements Mempool {
  /**
   * Bundles waiting for submission. 
   * 
   * TODO(keefertaylor): Consider using a Set for better performance, deferring this because I'm not sure how Sets do
   *                     object equality in Typescript.
   */
  private readonly bundles: Array<Bundle>

  /** Create a new InMemoryMempool */
  public constructor() {
    this.bundles = []
  }

  /** Mempool Interface */

  public addBundle(bundle: Bundle): Promise<boolean> {
    // Do not add duplicate operations
    if (this.contains(bundle)) {
      return Promise.resolve(false)
    }

    // Otherwise add a Bundle.
    this.bundles.push(bundle)
    return Promise.resolve(true)
  }

  getBundles(): Promise<Array<Bundle>> {
    return Promise.resolve(_.cloneDeep(this.bundles))
  }

  removeBundle(bundleToRemove: Bundle): Promise<boolean> {
    // Capture the old size of the Mempool
    const oldLength = this.bundles.length

    // Remove any matching objects.
    const newArray = _.remove(this.bundles, (bundle: Bundle) => {
      return _.isEqual(bundle, bundleToRemove)
    })

    // Compare lengths to figure out if the item existed.
    return Promise.resolve(oldLength !== newArray.length)
  }

  /** Helper Methods */

  /** 
   * Determine if the Mempool contains the given `Bundle`.
   * 
   * @param needle The `Bundle` to search for.
   * @returns A boolean indicating if the bundle was in the Mempool.
   */
  private contains(needle: Bundle): boolean {
    const result = _.find(this.bundles, (bundle: Bundle) => {
      return BundleUtils.isEqual(bundle, needle)
    })
    return result !== undefined
  }

}