import { Address } from "@flashbake/core"

/**
 * An interface that defines a service that communites with a Tezos Node's RPC.
 */
export default interface RpcService {
  /**
   * Get the identifying number of the big map located in the given contract with the given annotation.
   * 
   * @param contractAddress The address of the contract which contains the big map
   * @param annotation The annotation of the big map.
   * @returns The identifier of the big map
   */
  getBigMapIdentifier(contractAddress: Address, annotation: string): Promise<number>
}