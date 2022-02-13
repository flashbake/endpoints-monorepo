import { Bundle } from '@flashbake/core';
import { RegistryService } from './interfaces/registry-service';
import { Express, Request, Response } from 'express';
import * as bodyParser from 'body-parser';
import { encodeOpHash } from "@taquito/utils";  
import { createProxyMiddleware } from 'http-proxy-middleware';
import * as http from "http";
import BakingRightsService, { BakingAssignment } from './interfaces/baking-rights-service';
import RpcBakingRightsService from './implementations/rpc/rpc-baking-rights-service';


export default class HttpRelay {
  private static DEFAULT_INJECT_URL_PATH = '/injection/operation';
  private static DEFAULT_CUTOFF_INTERVAL = 5000; // 5 seconds

  /**
   * Cross-reference the provided baker addresses against the Flashbake registry to
   * identify the first matching Flashbake-capable baker. This baker's registered endpoint URL
   * is returned. 
   * 
   * @param bakers List of baking rights assignments, some of which are expected to be for Flashbake participating bakers
   * @returns Endpoint URL of the earliest upcoming baker in addresses who is found in the Flashbake registry
   */
  private findNextFlashbakerUrl(bakers: BakingAssignment[]): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
      // Iterate through baker addresses to discover the earliest upcoming participating baker.
      for (let baker of bakers) {
        // Fitting baker must still be in the future and within a certain cutoff buffer period.
        if (Date.parse(baker.estimated_time) >= (Date.now() + this.cutoffInterval)) {
          try {
            const address = baker.delegate;
            let endpoint = await this.registry.getEndpoint(address);
            if (endpoint) {
              console.debug(`Found endpoint ${endpoint} for address ${address} in flashbake registry.`);
              resolve(endpoint);
              return;
            }
          } catch(e) {
            const reason: string = (typeof e === "string") ? e : (e instanceof Error) ? e.message : "";
            console.error("Error while looking up endpoints in flashbake registry: " + reason);
            reject(reason);
          }
        }
      }

      reject("No matching flashbake endpoints found in the registry.");
    })
  }

  /**
   * Implements the handler for Flashbake injection requests from Tezos RPC clients. When
   * request is received, a list of upcoming baking rights assignements is fetched from the
   * node. These bakers are then assessed against the Flashbake registry to identify the
   * earliest upcoming Flashbake-participating baker. The transaction is then forwarded to
   * the baker via their Flashbake bundle ingestion endpoint, as advertized in the registry.
   */
  private injectionHandler(req: Request, res: Response) {
    const transaction = JSON.parse(req.body);
    console.log("Flashbake transaction received from client");
    console.debug(`Hex-encoded transaction content: ${transaction}`);
  
    this.bakingRightsService.getBakingRights().then((bakingRights) => {
      this.findNextFlashbakerUrl(bakingRights).then((endpointUrl) => {
        const bundle: Bundle = {
          transactions: [transaction],
          failableTransactionHashes: []
        };
        const bundleStr = JSON.stringify(bundle);
        const relayReq = http.request(
          endpointUrl, {
            method: 'POST',
            headers : {
              'User-Agent': 'Flashbake-Relay / 0.0.1',
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(bundleStr)      
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
              console.debug(`Received the following response from baker endpoint ${endpointUrl}: ${rawData}`);
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
        relayReq.write(bundleStr);
        relayReq.end();
      }).catch((reason) => {
        console.log(`Flashbaker URL not found in the registry: ${reason}`);
        res.status(500)
          .contentType('text/plain')
          .send('No flashbakers available for the remaining period this cycle.');
      })
    }).catch((reason) => {
      console.log(`Baking rights couldn't be fetched: ${reason}`);
      res.status(500)
        .contentType('text/plain')
        .send('Baking rights not available.');
    })
  }

  private attachFlashbakeInjector() {
    this.express.post(this.injectUrlPath, bodyParser.text({type:"*/*"}), (req, res) => {
      this.injectionHandler(req, res);
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
   * @param bakingRightsService Provider of baking rights assignments.
   * @param injectUrlPath path on the Express app to attach the transaction injection handler to.
   */
  public constructor(
    private readonly express: Express,
    private readonly registry: RegistryService,
    private readonly rpcApiUrl: string,
    private readonly bakingRightsService: BakingRightsService,
    private readonly cutoffInterval: number = HttpRelay.DEFAULT_CUTOFF_INTERVAL,
    private readonly injectUrlPath: string = HttpRelay.DEFAULT_INJECT_URL_PATH
  ) {
    this.attachFlashbakeInjector();
    this.attachHttpProxy();
  }
}