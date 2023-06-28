import { TezosParsedOperation } from './tezos-parsed-operation'
/**
 * A Bundle for Flashbake transactions.
 */
export type Bundle = {
  // Ordered list of signed transactions to include
  transactions: Array<TezosParsedOperation>
  // Indicate whether the sender wants the bundle to be included first or not at all.
  // true: inlcude first or not at all
  // false: include in the block in any position
  firstOrDiscard: boolean
}
