import _ from "lodash"
import { Bundle } from './types/bundle'

/** Helper functions for working with `Bundle` objects */
const BundleUtils = {
  /**
   * Determine if two `Bundle` objects are equal.
   * 
   * @param a The first `Bundle`
   * @param b The second `Bundle`
   * @returns A boolean indicating if the two `Bundle`s are equivalent.
   */
  isEqual: (a: Bundle, b: Bundle): boolean => {
    return _.isEqual(a, b)
  }
}

export default BundleUtils
