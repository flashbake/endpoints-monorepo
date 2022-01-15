import { TransactionHash } from "./core"
import { TezosTransaction } from "./tezos-transaction"

/**
 * A Bundle for Flashbake transactions.
 */
export type Bundle = {
  // Ordered list of signed transactions to include
  transactions: Array<TezosTransaction>

  // List of transaction hashes that can fail.
  // These hashes should be a subset of the `transaction` field
  failableTransactionHashes?: Array<TransactionHash>
}
