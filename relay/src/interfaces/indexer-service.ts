/** Implements an service that can communicate with a Tezos indexer */
export default interface IndexerService {
  /** 
   * Retrieves all keys and values in the given big map.
   * 
   * Generic in KeyType (the type of keys in the big map) and ValueType (the type of values in the big map).
   * 
   * @param bigMapId The identifier of the big map.
   * @returns A map of all keys to values.
   */
  getAllBigMapData<KeyType, ValueType>(bigMapId: number): Promise<Map<KeyType, ValueType>>
}