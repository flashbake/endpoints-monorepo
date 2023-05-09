import { TezosParsedOperation } from './tezos-parsed-operation'
/**
 * A Bundle for Flashbake transactions.
 */
export type Bundle = {
  // Ordered list of signed transactions to include
  transactions: Array<TezosParsedOperation>

}
