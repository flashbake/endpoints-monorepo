import { Address } from '../types/core';
import { BlockResponse } from '@taquito/rpc'
import { TezosToolkit } from '@taquito/taquito'
import RpcService from '../interfaces/rpc-service'

/**
 * Implements Tezos Node communication via the Taquito Typescript library.
 */
export default class TaquitoRpcService implements RpcService {
  // A TezosToolkit that can read or write to the Node's RPC API.
  private readonly tezos: TezosToolkit

  /**
   * Construct a new TaquitoRpcService
   * 
   * @param nodeUrl The url of the Tezos node.
   */
  public constructor(nodeUrl: string) {
    this.tezos = new TezosToolkit(nodeUrl)
  }

  /** RpcService Interface */

  public async getBigMapValue(contractAddress: Address, annotation: string, key: any): Promise<any> {
    let contract
    let storage: any
    try {
      contract = await this.tezos.contract.at(contractAddress)
      storage = await contract.storage()
    } catch (e: any) {
      throw new Error(`Couldn't resolve contract or storage. Underlying error: ${e.toString()}`)
    }

    // Throw if the annotation doesn't exist
    if (storage[annotation] === undefined) {
      throw new Error(`Could not find an annotation for ${annotation} in ${contractAddress}'s storage'`)
    }

    const map = storage[annotation]
    return map.get(key)
  }

  public async getBlock(block: string): Promise<BlockResponse> {
    return this.tezos.rpc.getBlock({ block: block });
  }
}
