/** 
 * Represents a Tezos operation object encoded in JSON 
 * Matches what you see when querying the node mempool by GETting
 * /chains/main/mempool/monitor_operations
 *
 */
export type TezosParsedOperation = {
  // branch is the head block hash when the transaction was built.
  // We use it to discard transactions after a while.
  branch: string

  contents: Array<any>

  signature: string
}
