import { Address } from "@flashbake/core"

/** Defines a registry service that can read the Flashbake Registry from an onchain contract */
export interface RegistryService {
  /** 
   * Determine whether the registry service has been initialized.
   * 
   * @returns A boolean indicating if the service is initialized.
   */
  isInititalized(): Promise<boolean>

  /**
   * Initialize the service.
   */
  initialize(): Promise<void>

  /**
   * Refresh the contracts from the registry.
   */
  refresh(): Promise<void>

  /**
   * Check if the given address is registered.
   * 
   * @param baker The baker to check.
   * @returns A boolean indicating if the baker is registered.
   */
  isRegistered(baker: Address): Promise<boolean>

  /**
   * Return an endpoint for the given baker.
   * 
   * @param baker The baker to query.
   * @returns A url for the baker's endpoint if it exists in the registry, otherwise undefined.
   */
  getEndpoint(baker: Address): Promise<string | undefined>
}
