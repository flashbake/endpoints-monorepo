import { Address, Bundle } from '@flashbake/core';
import { RegistryService } from './interfaces/registry-service';
import { Express } from 'express';
import * as bodyParser from 'body-parser';
import { encodeOpHash } from "@taquito/utils";  
import { createProxyMiddleware } from 'http-proxy-middleware';
import * as http from "http";


export default class HttpRelay {

  /**
   * Fetch baker rights assignments from Tezos node RPC API and parse them.
   * 
   * @returns Addresses of the bakers assigned in the current cycle in the order of their assignment
   */
  private getBakingRights(): Promise<Address[]> {
    return new Promise<Address[]>((resolve, reject) => {
      const addresses = new Array<Address>();
  
      http.get(`${this.rpcApiUrl}/chains/main/blocks/head/helpers/baking_rights?max_priority=0`, (resp) => {
        const { statusCode } = resp;
        const contentType = resp.headers['content-type'] || '';

        var error;
        if (statusCode !== 200) {
          error = new Error(`Baking rights request failed with status code: ${statusCode}.`);
        } else if (!/^application\/json/.test(contentType)) {
          error = new Error(`Baking rights request produced unexpected response content-type ${contentType}.`);
        }
        if (error) {
          console.error(error.message);
          resp.resume();
          return;
        }

        // A chunk of data has been received.
        var rawData = '';
        resp.on('data', (chunk) => { rawData += chunk; });
        resp.on('end', () => {
          try {
            const bakingRights = JSON.parse(rawData) as ({delegate: string})[];
            for (let bakingRight of bakingRights) {
              addresses.push(bakingRight.delegate);
            }
            resolve(addresses);
          } catch (e) {
            if (typeof e === "string") {
              reject(e);
            } else if (e instanceof Error) {
              reject(e.message);
            }
          }
        });
        }).on("error", (err) => {
          reject("Error while querying baker rights: " + err.message);
        });
    })
  }

  /**
   * Cross-reference the provided baker addresses against the Flashbake registry to
   * identify the first matching Flashbake-capable baker. This baker's registered endpoint URL
   * is returned. 
   * 
   * @param addresses List of baker addresses, some of which are expected to be Flashbake participating bakers
   * @returns Endpoint URL of the first baker in addresses who is found in the Flashbake registry
   */
  private findNextFlashbakerUrl(addresses: Address[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      // Iterate through baker addresses to discover the earliest upcoming participating baker
      for (let address of addresses) {
        // TODO: this has synchronization issues resulting in non-deterministic endpointUrl value
        // (first found based on potentially parallelized query execution, not necessarily earliest)
        this.registry.getEndpoint(address).then((endpoint) => {
          console.debug(`getNextFlashbakerUrl: endpoint=${endpoint} `);
          if (endpoint) {
            console.debug(`Found endpoint ${endpoint} for address ${address} in flashbake registry.`);
            resolve(endpoint);
          }
        }).catch((reason) => {
          console.error("Error while looking up endpoints in flashbake registry: " + reason);
          reject(reason);
        });
      }
    })
  }

  /**
   * Implements the handler for Flashbake injection requests from Tezos RPC clients. When
   * request is received, a list of upcoming baking rights assignements is fetched from the
   * node. These bakers are then assessed against the Flashbake registry to identify the
   * earliest upcoming Flashbake-participating baker. The transaction is then forwarded to
   * the baker via their Flashbake bundle ingestion endpoint, as advertized in the registry.
   */
  private attachFlashbakeInjector() {
    // URL where this daemon receives operations to be directly injected, bypassing mempool
    this.express.post(this.injectUriPath, bodyParser.text({type:"*/*"}), (req, res) => {
      const transaction = JSON.parse(req.body);
      console.log("Flashbake transaction received from client");
      console.debug(`Hex-encoded transaction content: ${transaction}`);
    
      this.getBakingRights().then((addresses) => {
        this.findNextFlashbakerUrl(addresses).then((endpointUrl) => {
          const relayReq = http.request(
            endpointUrl, {
              method: 'POST',
              headers : {
                'User-Agent': 'Flashbake-Relay / 0.0.1',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(req.body)      
              }
            }, (bakerEndpointResp) => {
              const { statusCode } = bakerEndpointResp;
          
              if (statusCode !== 200) {
                console.error(`Relay request to ${endpointUrl} failed with status code: ${statusCode}.`);
                bakerEndpointResp.resume();
              }

              var rawData = '';
              bakerEndpointResp.on('data', (chunk) => { rawData += chunk; });
              bakerEndpointResp.on('end', () => {
                console.debug(`Received the following response from relay ${endpointUrl}: ${rawData}`);
              })

              // the client expects the transaction hash to be immediately returned
              console.debug("transaction hash:");
              const opHash = encodeOpHash(JSON.parse(req.body));
              console.debug(opHash);
              res.json(opHash);
            }
          ).on("error", (err) => {
            console.log(`Error while relaying injection to ${endpointUrl}: ${err.message}`);
          });

          // relay transaction bundle to the remote flashbaker
          const bundle: Bundle = {
            transactions: [transaction],
            failableTransactionHashes: []
          }
          relayReq.write(JSON.stringify(bundle));
          relayReq.end();
        }, (reason) => {
          console.log(`Flashbaker URL not found in the registry: ${reason}`);
          res.sendStatus(500);
        })
      }, (reason) => {
        console.log(`Baking rights couldn't be fetched: ${reason}`);
        res.sendStatus(500);
      })
    });
  }


  /**
   * All operations that are not handled by this relay endpoint are proxied
   * into the node RPC endpoint.
   */
  private attachHttpProxy() {
    // all requests except for mempool are proxied to the node
    this.express.use('/*', createProxyMiddleware({
      target: this.rpcApiUrl,
      changeOrigin: false
    }));
  }
  
  /**
   * Create a new Flashbake Relay service on an Express webapp instance.
   * 
   * The service will set up Flashbake Relay API handlers on the supplied Express app
   * instance. Express app lifecycle, including listening status, is controlled externally.
   * The Relay supports operation injection identical to Tezos RPC, but on
   * 
   * @param express The Express app to which Flashbake API handlers will be added.
   * @param registry The registry of Flashbake participating bakers' endpoints.
   * @param rpcApiUrl Endpoint URL of RPC service of a Tezos node.
   * @param injectUriPath path on the Express app to attach the transaction injection handler to.
   */
  public constructor(
    private readonly express: Express,
    private readonly registry: RegistryService,
    private readonly rpcApiUrl: string,
    private readonly injectUriPath: string = '/flashbake_injection/operation'
  ) {
    this.attachFlashbakeInjector();
    this.attachHttpProxy();
  }
}