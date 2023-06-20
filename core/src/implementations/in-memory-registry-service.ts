import { RegistryService } from "../interfaces/registry-service";
import { Address } from "../types/core";
import IndexerService from "../interfaces/indexer-service";
import RpcService from "../interfaces/rpc-service";
import { RegistryValue } from "../types/registry-value";

// Annotation for registry big map
const REGISTRY_BIG_MAP_ANNOTATION = "registry"

/**
 * An implementation of RegistryService which holds the mapping in memory.
 * 
 * This implementation has minimal dependencies and logic, however it is volatile and will not persist data between 
 * runs.
 */
export default class InMemoryRegistryService implements RegistryService {
  /** Whether the registry service is initialized. */
  private initialized: boolean

  /** Baker mapping from public key hash to their registry value. */
  private bakerMapping: Map<Address, RegistryValue>

  /**
   * Create a new InMemoryRegistryService.
   * 
   * The service will automatically start initialization.
   * 
   * @param registryContractAddress The address of the registry contract.
   * @param rpcService An RPC service that can connect to a Tezos node.
   * @param indexerService An indexer service that can connect to a Tezos indexer.
   */
  public constructor(
    // private readonly registryContractAddress: Address,
    // private readonly rpcService: RpcService,
    // private readonly indexerService: IndexerService
  ) {
    // Set to be unitialized at construction time.
    this.initialized = false
    this.bakerMapping = new Map<Address, RegistryValue>()

    // Kick off an initilization
    this.initialize()
  }

  /** RegistryService interface */

  public isInititalized(): Promise<boolean> {
    return Promise.resolve(this.initialized)
  }

  public async initialize(): Promise<void> {
    // If initialization already happened, warn and  do nothing.
    if (this.initialized) {
      console.warn("Warning: InMemoryRegistryService is already initialized. This call is a no-op.")
      return
    }

    // Refresh the registry and update the initialization state when complete.
    await this.refresh()
    this.initialized = true
  }

  public async refresh(): Promise<void> {
    // Read new data from the registry
    /* 

    In-memory service is always in sync

    const registryBigMapId = await this.rpcService.getBigMapIdentifier(
      this.registryContractAddress,
      REGISTRY_BIG_MAP_ANNOTATION
    )
    this.bakerMapping = await this.indexerService.getAllBigMapData<Address, RegistryValue>(registryBigMapId)
    */
  }

  public isRegistered(baker: Address): Promise<boolean> {
    return Promise.resolve(this.bakerMapping.has(baker))
  }

  public setEndpoint(baker: Address, endpointUrl: string) {
    this.bakerMapping.set(baker, { endpointUrl: endpointUrl });
  }

  public getEndpoint(baker: Address): Promise<string | undefined> {
    var rv = this.bakerMapping.get(baker);

    if (!rv) {
      // Return undefined if the baker is not known.
      return Promise.resolve(undefined);
    }

    return Promise.resolve(rv.endpointUrl);
  }
}
