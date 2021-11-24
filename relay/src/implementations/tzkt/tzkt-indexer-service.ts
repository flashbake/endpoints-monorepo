import axios from 'axios'
import IndexerService from '../../interfaces/indexer-service'
import { Network } from '@flashbake/core'

/**
 * The type of an object returned by the TzKt API
 */
type BigMapResponse = {
  id: number
  active: boolean
  hash: string
  key: any,
  value: any
  firstLevel: number,
  lastLevel: number,
  updates: number
}

/**
 * Implements an IndexerService by connecting to the TzKt API.
 * 
 * @see https://api.tzkt.io/
 * 
 * TODO(keefertaylor): Implement retry logic for failed pagination requests due to rate limiting.
 * TODO(keefertaylor): Implement the concepts of network selection and automatically resolve base url.
 */
export default class TzKtIndexerService implements IndexerService {
  /** The base URL for API requests */
  private readonly baseUrl: string

  /**
   * Create a new TzKtIndexerService.
   * 
   * @param network The network the indexer is used on.
   */
  public constructor(network: Network) {
    switch (network) {
      case Network.Granadanet:
        this.baseUrl = "https://api.granadanet.tzkt.io/"
        break
      case Network.Mainnet:
        this.baseUrl = "https://api.tzkt.io/v1"
        break
    }
  }

  /** IndexerService Interface */

  public async getAllBigMapData<KeyType, ValueType>(bigMapId: number): Promise<Map<KeyType, ValueType>> {
    // Pagination parameters.
    const pageSize = 1000
    let offset = 0

    // Loop through all pages and collate results.
    const resolvedValues: Map<KeyType, ValueType> = new Map<KeyType, ValueType>()
    let returnedResults = 0
    do {
      // Fetch from API and update keys
      const apiUrl = `${this.baseUrl}/bigmaps/${bigMapId}/keys?limit=${pageSize}&offset=${offset}`
      const results: Array<BigMapResponse> = (await axios.get(apiUrl)).data
      results.forEach((result: BigMapResponse) => {
        resolvedValues.set(result.key, result.value)
      })

      // Update pagination parameters for next run
      returnedResults = results.length
      offset += pageSize
    } while (returnedResults === pageSize)

    return resolvedValues
  }
}