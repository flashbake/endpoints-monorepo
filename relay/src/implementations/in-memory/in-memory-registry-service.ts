import { RegistryService } from "../../interfaces/registry-service";
import { Address } from "@flashbake/core";

/**
 * An implementation of RegistryService which holds the mapping in memory.
 * 
 * This implementation has minimal dependencies and logic, however it is volatile and will not persist data between 
 * runs.
 */
export default class InMemoryRegistryService implements RegistryService {
  /** Whether the registry service is initialized. */
  private initialized: boolean

  /** Baker mapping from public key hash to endpoint. */
  private readonly bakerMapping: Map<Address, string>

  /**
   * Create a new InMemoryRegistryService.
   * 
   * The service will automatically start initialization.
   */
  public constructor() {
    // Set to be unitialized at construction time.
    this.initialized = false
    this.bakerMapping = new Map<Address, string>()

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

  // TODO(keefertaylor): Implement
  refresh(): Promise<void> {
    throw new Error("Method not implemented.");
  }

  isRegistered(baker: Address): Promise<boolean> {
    return Promise.resolve(this.bakerMapping.has(baker))
  }

  getEndpoint(baker: Address): Promise<string> {
    // Return undefined if the baker is not known.
    if (this.isRegistered(baker)) {
      return undefined
    }
    return this.bakerMapping[baker]
  }
}
