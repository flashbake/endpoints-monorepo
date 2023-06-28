import { RegistryService } from "../interfaces/registry-service";
import { Address } from "../types/core"
import RpcService from "../interfaces/rpc-service";
import { RegistryValue } from "../types/registry-value";

// Annotation for registry big map
const REGISTRY_BIG_MAP_ANNOTATION = "registry"
// Address for registry contract
const REGISTRY_CONTRACT_ADDRESS = "KT1QuofAgnsWffHzLA7D78rxytJruGHDe7XG"

/**
 * An implementation of RegistryService which uses an on-chain smart contract for baker lookups.
 * 
 */
export default class OnChainRegistryService implements RegistryService {
  /** Whether the registry service is initialized. */
  private initialized: boolean

  /**
   * Create a new OnChainRegistryService.
   * 
   * The service will automatically start initialization.
   * 
   * @param rpcService An RPC service that can connect to a Tezos node.
   * @param contractAddress The address of the registry contract.
   * @param bigmapAnnotation The annotation of the contract's baker bigmap.
   */
  public constructor(
    private readonly rpcService: RpcService,
    private readonly contractAddress: string,
    private readonly bigmapAnnotation: string,
  ) {
    // Set to be unitialized at construction time.
    this.initialized = false

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
      console.warn("Warning: OnChainRegistryService is already initialized. This call is a no-op.")
      return
    }

    // Refresh the registry and update the initialization state when complete.
    await this.refresh()
    this.initialized = true
  }

  public async refresh(): Promise<void> {
    // Read new data from the registry
    /*
      Not needed, as all requests are fulfilled via on-chain lookups (vs. in-memory state).
    */
  }

  public isRegistered(baker: Address): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      this.rpcService.getBigMapValue(this.contractAddress, this.bigmapAnnotation, baker).then(value => {
        resolve(value !== undefined);
      }).catch(err => {
        reject(err)
      })
    })
  }

  public getEndpoint(baker: Address): Promise<string | undefined> {
    return new Promise<string>((resolve, reject) => {
      this.rpcService.getBigMapValue(this.contractAddress, this.bigmapAnnotation, baker).then(value => {
        if ((value !== undefined) && ((value as RegistryValue).endpointUrl !== undefined)) {
          resolve((value as RegistryValue).endpointUrl);
        } else {
          resolve('');
        }
      }).catch(err => {
        reject(err)
      })
    })
  }
}
