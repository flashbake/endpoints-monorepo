import { Address } from "@flashbake/core"

/**
 * An interface that defines a service that communites with a Tezos Node's RPC.
 */
export default interface RpcService {
  /**
   * Get the value of the a big map located in the given contract with the given annotation.
   *
   * @param contractAddress The address of the contract which contains the big map
   * @param annotation The annotation of the big map.
   * @param key The key
   */
  getBigMapValue(contractAddress: Address, annotation: string, key: any): Promise<any>
}