import { Bundle, TezosTransaction } from '@flashbake/core';
import { RegistryService } from './interfaces/registry-service';
import { Express, Request, Response } from 'express';
import * as bodyParser from 'body-parser';
import { encodeOpHash } from "@taquito/utils";  
import { createProxyMiddleware } from 'http-proxy-middleware';
import * as http from "http";
import BakingRightsService, { BakingAssignment } from './interfaces/baking-rights-service';
import BlockMonitor, { BlockNotification, BlockObserver } from './interfaces/block-monitor';
import TaquitoRpcService from './implementations/taquito/taquito-rpc-service';


export default class HttpRelay implements BlockObserver {
  private static DEFAULT_INJECT_URL_PATH = '/injection/operation';
  private static DEFAULT_CUTOFF_INTERVAL = 5000; // 5 seconds

  // pending bundles keyed by the hash of their first transaction
  private readonly bundles = new Map<TezosTransaction,Bundle>();

  private readonly taquitoService: TaquitoRpcService;

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
        console.debug(`Analyzing baker address ${baker.delegate}`);

        // Fitting baker must still be in the future and within a certain cutoff buffer period.
        if (Date.parse(baker.estimated_time) >= (Date.now() + this.cutoffInterval)) {
          try {
            const address = baker.delegate;
            let endpoint = await this.registry.getEndpoint(address);
            console.debug(`Baker ${address} has baking rights at round ${baker.round} for level ${baker.level} estimated to bake at ${baker.estimated_time}, registered endpoint URL ${endpoint}`);

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
        } else {
          console.debug(`Baker ${baker.delegate} rejected due to insufficient remaining time: ${Date.parse(baker.estimated_time) - Date.now()} ms`)
        }
      }

      reject("No matching flashbake endpoints found in the registry.");
    })
  }

  private relayBundle(bundle: Bundle, res?: Response) {
    const opHash = encodeOpHash(bundle.transactions[0]);
    console.debug(`Transaction hash: ${opHash}`);

    // Retain bundle in memory for re-relaying until its transactions are observed on-chain
    this.bundles.set(opHash, bundle);
    
    this.bakingRightsService.getBakingRights().then((bakingRights) => {
      this.findNextFlashbakerUrl(bakingRights).then((endpointUrl) => {
        const bundleStr = JSON.stringify(bundle);
        // console.debug("Sending to flashbake endpoint:");
        // console.debug(bundleStr);

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
        
            if (statusCode == 200) {
              // return transaction hash to the client on acceptance
              if (res) {
                res.json(opHash);
              }
            } else {
              console.error(`Relay request to ${endpointUrl} failed with status code: ${statusCode}.`);
              bakerEndpointResp.resume();
            }

            var rawData = '';
            bakerEndpointResp.on('data', (chunk) => { rawData += chunk; });
            bakerEndpointResp.on('end', () => {
              console.debug(`Received the following response from baker endpoint ${endpointUrl}: ${rawData}`);
            })
          }
        ).on("error", (err) => {
          console.log(`Error while relaying injection to ${endpointUrl}: ${err.message}`);
          if (res) {
            res.status(500)
              .contentType('text/plain')
              .send('Transaction could not be relayed.');
          }
        });

        // relay transaction bundle to the remote flashbaker
        relayReq.write(bundleStr);
        relayReq.end();
      }).catch((reason) => {
        console.log(`Flashbaker URL not found in the registry: ${reason}`);
        if (res) {
          res.status(500)
            .contentType('text/plain')
            .send('No flashbakers available for the remaining period this cycle.');
        }
      })
    }).catch((reason) => {
      console.log(`Baking rights couldn't be fetched: ${reason}`);
      if (res) {
        res.status(500)
          .contentType('text/plain')
          .send('Baking rights not available.');
      }
    })
  }
  
  onBlock(notification: BlockNotification): void {
    // Examine the content of block at level head-2 (ignoring more recent blocks with questionable finality)
    // this.taquitoService.getBlock('head~2').then((block) => {
    this.taquitoService.getBlock('head').then((block) => {
      console.debug(`Baker of block level ${block.header.level} at ${block.header.timestamp} was ${block.metadata.baker}`);

      for (var operations of block.operations) {
        // console.debug('Operation hashes:');
        for (var operation of operations) {
          // console.debug('\t' + operation.hash);

          // Remove any bundles found on-chain from pending resend queue
          if (this.bundles.delete(operation.hash)) {
            console.info(`Relayed bundle identified by operation hash ${operation.hash} found on-chain.`);
            console.debug(`${this.bundles.size} bundles remain pending.`);
          }
        }
      }

      // Resend for baking any bundles that were not found in the examined block 
      // TODO: refactor this to avoid registry lookups and baker endpoint connection setup/teardown per bundle
      for (var bundleEntry of this.bundles) {
        console.debug(`Transaction hash ${bundleEntry[0]} not detected, resending the bundle.`)
        this.relayBundle(bundleEntry[1]);
      }
    }).catch((reason) => {
      console.error(`Block request failed: ${reason}`);
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
    // console.debug(`Hex-encoded transaction content: ${transaction}`);

    const bundle: Bundle = {
      transactions: [transaction],
      failableTransactionHashes: []
    };
    this.relayBundle(bundle, res);
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
   * @param blockMonitor a block monitor service to allow subscription to notifications of new blocks.
   * @param injectUrlPath path on the Express app to attach the transaction injection handler to.
   */
  public constructor(
    private readonly express: Express,
    private readonly registry: RegistryService,
    private readonly rpcApiUrl: string,
    private readonly bakingRightsService: BakingRightsService,
    private readonly blockMonitor: BlockMonitor,
    private readonly cutoffInterval: number = HttpRelay.DEFAULT_CUTOFF_INTERVAL,
    private readonly injectUrlPath: string = HttpRelay.DEFAULT_INJECT_URL_PATH
  ) {
    this.attachFlashbakeInjector();
    this.attachHttpProxy();
    this.blockMonitor.addObserver(this);
    this.taquitoService = new TaquitoRpcService(rpcApiUrl);
  }
}