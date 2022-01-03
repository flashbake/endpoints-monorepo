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
   * curl -s  --header "accept: application/octet-stream"  http://localhost:8732/chains/main/mempool/monitor_operations | xxd -p 
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
    console.log("Blake hash of transaction: ");
    console.log(dump(transactionBlakeHash));
    console.log("Binary Transaction branch:");
    console.log(dump(binaryClientTransactionBranch));
    console.log("Binary Transaction contents and signature:");
    console.log(dump(binaryClientTransactionContentsAndSignature));

    binaryMempoolTransaction = Buffer.concat( [binaryMempoolTransaction, transactionBlakeHash ]);
    binaryMempoolTransaction = Buffer.concat( [binaryMempoolTransaction, Buffer.from("00000020", 'hex') ]);
    binaryMempoolTransaction = Buffer.concat( [binaryMempoolTransaction, binaryClientTransactionBranch ]);
    binaryMempoolTransaction = Buffer.concat( [binaryMempoolTransaction, Buffer.from("00000078", 'hex') ]);
    binaryMempoolTransaction = Buffer.concat( [binaryMempoolTransaction, binaryClientTransactionContentsAndSignature ]);
    binaryMempoolTransaction = Buffer.concat( [binaryMempoolTransaction, Buffer.from("00000006060000008a00", 'hex') ]);

    return binaryMempoolTransaction;
  }

  private getBakingRights(): Promise<Address[]> {
    console.log('--- in getBakingRights() --- ');
  
    return new Promise<Address[]>((resolve, reject) => {
      const addresses = new Array<Address>();
  
      http.get('http://localhost:8732/chains/main/blocks/head/helpers/baking_rights?max_priority=0', (resp) => {
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
            console.log("Received the following baking rights response from node's mempool:\n" + rawData);
            const bakingRights = JSON.parse(rawData) as ({delegate: string})[];
            console.log(`parsed: ${bakingRights}`);
            for (let bakingRight of bakingRights) {
              console.log(`Adding ${bakingRight.delegate} to available flashbake addresses`);
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

  private findNextFlashbakerUrl(addresses: Address[]): Promise<string> {
    console.log('--- in getNextFlashbakerUrl() --- ');
    
    return new Promise<string>((resolve, reject) => {
      // Iterate through baker addresses to discover the earliest upcoming participating baker
      for (let address of addresses) {
        console.log(`getNextFlashbakerUrl: considering baker address ${address}`);

        // TODO: this has synchronization issues resulting in non-deterministic endpointUrl value
        // (first found based on potentially parallelized query execution, not necessarily earliest)
        this.registry.getEndpoint(address).then((endpoint) => {
          console.log(`getNextFlashbakerUrl: endpoint=${endpoint} `);
          if (endpoint) {
            console.log(`Found endpoint ${endpoint} for address ${address} in flashbake registry.`);
            resolve(endpoint);
          }
        }).catch((reason) => {
          console.error("Error while looking up endpoints in flashbake registry: " + reason);
          reject(reason);
        });
      }
    })
  }

  private initFlashbakeInjection() {
    // URL where this daemon receives operations to be directly injected, bypassing mempool
    this.express.post('/flashbake_injection/operation', bodyParser.text({type:"*/*"}), (req, res) => {
      let transaction = JSON.parse(req.body);
      console.log("flashbake hex-encoded transaction received from client:");
      console.log(transaction);
    
      this.getBakingRights().then((addresses) => {
        this.findNextFlashbakerUrl(addresses).then((endpointUrl) => {
          if (endpointUrl === this.selfUrl) {
            // If earliest upcoming Flashbake participating baker is self, add transaction to local Flashbake pool
            console.log("pushing into flashbake special mempool");
            // flashbakePool.push(transaction);
            this.flashbakePool.addBundle({
              transactions: [transaction],
              failableTransactionHashes: []
            });
  
            // the client expects the transaction hash to be immediately returned
            console.log("transaction hash:");
            const opHash = encodeOpHash(JSON.parse(req.body));
            console.log(opHash);
            res.json(opHash);
          } else {
            // ...otherwise relay it to that baker via their /flashbake_injection/operation
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
                  console.log(`Received the following response from relay ${endpointUrl}:\n${rawData}`);
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

  private initDefaultProxy() {
    // every query except mempool is directly proxied to the node
    this.express.use('/*', createProxyMiddleware({
      target: this.rpcApiUrl,
      changeOrigin: false
    }));
  }
  
  private initMempoolResponder() {
    // the baker queries the node's mempool in binary format (important)
    const octezMempoolRequestOpts = {
      hostname: '127.0.0.1',
      port: 8732,
      path: '/chains/main/mempool/monitor_operations',
      headers: {'accept': 'application/octet-stream' }
    }
    // mempool queries are handled directly
    this.express.get('/chains/main/mempool/monitor_operations', (req, res) => {
      http.get(octezMempoolRequestOpts,
      (resp) => {
        res.removeHeader("Connection");
        // A chunk of data has been received.
        resp.on('data', (chunk) => {
          console.log("Received the following from node's mempool:");
          console.log(dump(chunk));
          // if (flashbakePool.length > 0) {
          this.flashbakePool.getBundles().then((bundles) => {
            if (bundles.length > 0) {
                console.log("Found a transaction in flashbake special mempool, injecting it");
                const binaryTransactionToInject = this.convertTransactionToMempoolBinary(bundles[0].transactions[0] as string);
                console.log("Transaction to inject: \n" + dump(binaryTransactionToInject));
                res.write(binaryTransactionToInject);
                // flashbakePool = [] // for now, just empty mempool once one transaction has been injected
                this.flashbakePool.removeBundle(bundles[0]);
            }
          });
          console.log("Injecting");
          res.write(chunk);
        });

        // octez has ended the response (because a new head has been validated)
        resp.on('end', () => {
          res.end();
        });

      }).on("error", (err) => {
        console.log("Error: " + err.message);
      });
    })
  }

  /**
   * Create a new Flashbake relay service on an Express app instance.
   * 
   * The service will set up Flashbake relay API handlers on the supplied Express app
   * instance. However, app listening status is controlled externally.
   * 
   * @param express The Express app to which Flashbake API handlers will be added.
   * @param registry The registry of Flashbake participating bakers' endpoints.
   * @param flashbakePool Memory pool of bundles submitted via Flashbake relay.
   * @param rpcApiUrl Endpoint URL of RPC service of a Tezos node.
   * @param selfAddress Contract address associated with this baker's relay endpoint.
   * @param selfUrl Endpoint URL of this Flashbake relay service as seen from the outside.
   */
  public constructor(
    private readonly express: Express,
    private readonly registry: RegistryService,
    private readonly flashbakePool: Mempool,
    private readonly rpcApiUrl: string,
    private readonly selfAddress: string,
    private readonly selfUrl: string,
  ) {
    this.initFlashbakeInjection();
    this.initMempoolResponder();
    this.initDefaultProxy();
  }
}