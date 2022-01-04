import { Address } from '../../core';
import { RegistryService } from '../../relay';
import { Mempool } from "../../relay";
import { Express } from 'express';
import * as bodyParser from 'body-parser';
import { encodeOpHash } from "@taquito/utils";  
import { createProxyMiddleware, Filter, Options, RequestHandler } from 'http-proxy-middleware';
import * as http from "http";

const dump = require('buffer-hexdump');
const blake = require('blakejs');

// TODO: migrate to bodyParser wherever parsing response bodies

export default class HttpRelay {

  /**
   * Utility method that takes a hex-encoded transaction received from a tezos client
   * and converts it into binary that the baker expects from the /mempool/monitor_operations
   * endpoint.
   * 
   * This was reverse-engineered by comparing the transaction hex format
   * showing when sending a transaction with tezos-client -l (which shows
   * all rpc requests) and the same transaction visible from 
   * curl -s  --header "accept: application/octet-stream"  ${rpcApiUrl}/chains/main/mempool/monitor_operations | xxd -p 
   * Note that this mempool format is not parseable by tezos-codec
   * 
   * @author Nicolas Ochem
   * @param transaction hex-encoded transaction received from a tezos client
   * @returns binary that the baker expects from the /mempool/monitor_operations endpoint
   */
  private convertTransactionToMempoolBinary(transaction: string) {
    let binaryClientTransaction = Buffer.from(transaction, 'hex');
    let binaryClientTransactionBranch = binaryClientTransaction.slice(0,32);
    let binaryClientTransactionContentsAndSignature = binaryClientTransaction.slice(32);
    // let's compose a binary transaction in mempool format.
    // First, we start with these bytes
    let binaryMempoolTransaction = Buffer.from("000000ce000000ca", 'hex');
    // Then we add the blake hash of the operation (this is not present in the transaction sent from client, not sure why it's here)
    const transactionBlakeHash = blake.blake2b(binaryClientTransaction, null, 32);
    console.debug("Blake hash of transaction: ");
    console.debug(dump(transactionBlakeHash));
    console.debug("Binary Transaction branch:");
    console.debug(dump(binaryClientTransactionBranch));
    console.debug("Binary Transaction contents and signature:");
    console.debug(dump(binaryClientTransactionContentsAndSignature));

    binaryMempoolTransaction = Buffer.concat( [binaryMempoolTransaction, transactionBlakeHash ]);
    binaryMempoolTransaction = Buffer.concat( [binaryMempoolTransaction, Buffer.from("00000020", 'hex') ]);
    binaryMempoolTransaction = Buffer.concat( [binaryMempoolTransaction, binaryClientTransactionBranch ]);
    binaryMempoolTransaction = Buffer.concat( [binaryMempoolTransaction, Buffer.from("00000078", 'hex') ]);
    binaryMempoolTransaction = Buffer.concat( [binaryMempoolTransaction, binaryClientTransactionContentsAndSignature ]);
    binaryMempoolTransaction = Buffer.concat( [binaryMempoolTransaction, Buffer.from("00000006060000008a00", 'hex') ]);

    return binaryMempoolTransaction;
  }

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
   * Implements the handler for Flashbake injection requests. When request is received,
   * a list of upcoming baking rights assignements is fetched from the node. These bakers are
   * then assessed against the Flashbake registry to identify the earliest upcoming Flashbake-
   * participating baker. If found to be itself (the baker operating this relay service), the
   * submitted transaction is added to the Flashbake mempool for subsequent submission to the
   * baker process via monitor_operations request. Otherwise, the transaction is forwarded to
   * the remote baker via their Flashbake injection endpoint, as advertized in the registry.
   */
  private attachFlashbakeInjector() {
    // URL where this daemon receives operations to be directly injected, bypassing mempool
    this.express.post('/flashbake_injection/operation', bodyParser.text({type:"*/*"}), (req, res) => {
      let transaction = JSON.parse(req.body);
      console.log("Flashbake transaction received from client");
      console.debug(`Hex-encoded transaction content: ${transaction}`);
    
      this.getBakingRights().then((addresses) => {
        this.findNextFlashbakerUrl(addresses).then((endpointUrl) => {
          if (endpointUrl == this.selfUrl) {
            // Earliest upcoming Flashbake participating baker is self, hence adding transaction to local Flashbake pool
            console.log("Pushing transaction into flashbake special mempool");
            this.mempool.addBundle({
              transactions: [transaction],
              failableTransactionHashes: []
            });
  
            // the client expects the transaction hash to be immediately returned
            console.debug("transaction hash:");
            const opHash = encodeOpHash(JSON.parse(req.body));
            console.debug(opHash);
            res.json(opHash);
          } else {
            // Earliest upcoming Flashbake participating baker is not self, hence relaying it to that baker via their /flashbake_injection/operation
            const relayReq = http.request(
              endpointUrl, {
                method: 'POST',
                headers : {
                    'User-Agent': 'Flashbake-Relay / 0.0.1',
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(req.body)      
                }
              }, (resp) => {
                const { statusCode } = resp;
            
                if (statusCode !== 200) {
                  console.error(`Relay request to ${endpointUrl} failed with status code: ${statusCode}.`);
                  resp.resume();
                }
            
                var rawData = '';
                resp.on('data', (chunk) => { rawData += chunk; });
                resp.on('end', () => {
                  console.debug(`Received the following response from relay ${endpointUrl}:\n${rawData}`);
                  // forwared response to relay client
                  res.write(rawData);
                })
              }
            ).on("error", (err) => {
              console.log(`Error while relaying injection to ${endpointUrl}: ${err.message}`);
            });

            // relay original request to the remote flashbaker
            relayReq.write(req.body);
            relayReq.end();
          }
        })
      }).catch((reason) => {
        console.error(reason);
        throw reason;
      });
    });
  }

  /**
   * Node RPC provides an interface through which the baker queries the node's active mempool.
   * Since Flashbake Relay is responsible for controlling Flashbake transaction routing and
   * pooling, it also provides a replacement for this mempool access interface, thus allowing
   * the baker to access the Flashbake mempool.
   * 
   * This method implements the handler for baker's queries of the node's mempool (in binary
   * format). Returned transactions include the pending transactions from the regular Tezos
   * mempool together with any transactions from the local Flashbake mempool.
   */
  private attachMempoolResponder() {
    this.express.get('/chains/main/mempool/monitor_operations', (req, res) => {
      http.get(`${this.rpcApiUrl}/chains/main/mempool/monitor_operations`,
        {headers: {'accept': 'application/octet-stream' }},
        (resp) => {
          res.removeHeader("Connection");
          // A chunk of data has been received.
          resp.on('data', (chunk) => {
            console.debug("Received the following from node's mempool:");
            console.debug(dump(chunk));
            this.mempool.getBundles().then((bundles) => {
              if (bundles.length > 0) {
                console.debug("Found a transaction in flashbake special mempool, injecting it");
                const binaryTransactionToInject = this.convertTransactionToMempoolBinary(bundles[0].transactions[0] as string);
                console.debug("Transaction to inject: \n" + dump(binaryTransactionToInject));
                res.write(binaryTransactionToInject);
                this.mempool.removeBundle(bundles[0]);
              }
            });
            console.debug("Injecting");
            res.write(chunk);
          });

          // octez has ended the response (because a new head has been validated)
          resp.on('end', () => {
            res.end();
          });
        }
      ).on("error", (err) => {
        console.error("Error: " + err.message);
      });
    })
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
   *
   * Deployment model assumptions made by this Flashbake Relay service are such that this service:
   * * allows both Flashbake-aware and non-Flashbake-aware transaction submitters to safely interact with it;
   * * adds transactions from Flashbake-aware submitters to the local mempool or forwards them to the remote Flashbake-participating baker (targeting earliest injection opportunity based on the order of assigned baking rights);
   * * provides to the baker process the combined mempool content from the general node mempool and from the local Flashbake mempool;
   * * proxies to the Tezos node RPC all HTTP requests that it doesn't handle directly.
   * 
   * Thus the intent is that this service be exposed as the primary Tezos RPC endpoint for all
   * consumers (Flashbake-aware clients, non-Flashbake-aware clients, baker process).
   * 
   * This service does not provide access controls for mempool fetch API call
   * (/chains/main/mempool/monitor_operations), allowing Flashbake transactions with
   * varying levels of privacy expectations to be accessed by potentially unauthorized actors.
   * Since this is counter to the privacy goals of the Flashbake protocol, deployment-level
   * access controls for mempool fetch API call should be considered by service operators.
   * 
   * @param express The Express app to which Flashbake API handlers will be added.
   * @param registry The registry of Flashbake participating bakers' endpoints.
   * @param mempool Memory pool of bundles submitted via Flashbake Relay.
   * @param rpcApiUrl Endpoint URL of RPC service of a Tezos node.
   * @param selfUrl Endpoint URL of this Flashbake relay service as seen from the outside.
   */
  public constructor(
    private readonly express: Express,
    private readonly registry: RegistryService,
    private readonly mempool: Mempool,
    private readonly rpcApiUrl: string,
    private readonly selfUrl: string,
  ) {
    this.attachFlashbakeInjector();
    this.attachMempoolResponder();
    this.attachHttpProxy();
  }
}