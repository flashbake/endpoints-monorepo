import { Bundle } from '@flashbake/core'

/**
 * A pool of pending bundles to be placed in Flashback.
 * 
 * TODO(keefertaylor): It is unclear what identifiers should exist here. How do we do `Bundle` equality checks.
 */
export default interface Mempool {
  /** 
   * Add a `Bundle` to the pool. 
   *
   * @param bundle The bundle to add.
   * @returns A boolean indicating whether the given `Bundle` was accepted. 
   */
  addBundle(bundle: Bundle): Promise<boolean>

  /** 
   * Retrieve a list of `Bundle`s in the pool.
   * 
   * @returns An array of `Bundle`s in the pool.
   */
  getBundles(): Promise<Array<Bundle>>

  /** 
   * Remove a `Bundle` from the pool. 
   *
   * @param bundle The `Bundle` to remove
   * @returns A boolean indicating whether the `Bundle` was removed. 
   */
  removeBundle(bundle: Bundle): Promise<boolean>

  /** 
   * Remove all `Bundle`s from the pool. 
   */
   flush(): void
}
