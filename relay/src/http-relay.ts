import { Bundle, TezosParsedOperation, TezosOperationUtils } from '@flashbake/core';
import { RegistryService } from './interfaces/registry-service';
import BakingRightsService, { BakingAssignment } from './interfaces/baking-rights-service';
import { BlockMonitor, BlockNotification, BlockObserver } from '@flashbake/core';
import TaquitoRpcService from './implementations/taquito/taquito-rpc-service';

import { Express, Request, Response } from 'express';
import * as bodyParser from 'body-parser';
import { encodeOpHash } from "@taquito/utils";
import { RpcClient } from "@taquito/rpc";
import { createProxyMiddleware } from 'http-proxy-middleware';
import * as http from "http";
import * as https from "https";
import * as prom from 'prom-client';


interface ManagerKeyCache {
  [source: string]: string;
}
export default class HttpRelay implements BlockObserver {
  private static INJECT_URL_PATH = '/injection/operation';
  private static CUTOFF_INTERVAL = 1000; // 1 second
  private static METRICS_URL_PATH = '/metrics';
  private static BUNDLE_EXPIRATION_TIME = 1000 * 60 * 60;  // 1 hour

  // most recent observed chain block level
  private lastBlockLevel = 0;

  private readonly managerKeyCache: ManagerKeyCache;

  // Next Flashbaker assignment
  private nextFlashbaker: BakingAssignment | undefined;

  // pending operations indexed by op hash
  private readonly operations: { [index: string]: TezosParsedOperation } = {};

  private readonly taquitoService: TaquitoRpcService;

  // list of bakers who produced blocks with relayed transactions
  private readonly successfulBakersList: string[] = [];

  private readonly metricReceivedBundlesTotal = new prom.Counter({
    name: 'flashbake_received_bundles_total',
    help: 'Total number of bundles received by the relay',
  });

  private readonly metricSuccessfulBundlesTotal = new prom.Counter({
    name: 'flashbake_successful_bundles_total',
    help: 'Total number of bundles successfully submitted on-chain',
  });

  private readonly metricSuccessfulBakersTotal = new prom.Counter({
    name: 'flashbake_successful_bakers_total',
    help: 'Number of unique flashbakers with bundles on-chain',
  });

  private readonly metricPendingBundles = new prom.Gauge({
    name: 'flashbake_pending_bundles',
    help: 'Current number of bundles in relay queue',
  });

  private readonly metricBundleResendsTotal = new prom.Counter({
    name: 'flashbake_bundle_resends_total',
    help: 'Total number of bundle resends',
  });

  private readonly metricDroppedBundles = new prom.Counter({
    name: 'flashbake_dropped_bundles',
    help: 'Total number of dropped bundles',
  });

  private readonly metricBlockWaitSeconds = new prom.Gauge({
    name: 'flashbake_block_wait_seconds',
    help: 'Expected duration until the next Flashbake block for the most recent submitted or resent bundle at the time of its relay',
  });

  private relayBundle(bundle: Bundle) {
    // Bundles are sending hex formatted transactions to the wire, doing the conversion here.
    let hexOps: Promise<string>[] = [];
    bundle.transactions.forEach(op => {
      hexOps.push(TezosOperationUtils.operationToHex(op as TezosParsedOperation));
      this.metricBundleResendsTotal.inc();
    })
    console.log(`Sending bundle ${JSON.stringify(Object.keys(this.operations).map((op) => op.substring(0, 6) + ".."))} to Flashbaker with "any position" flag.`)
    Promise.all(hexOps).then(hexOps => {
      const bundleStr = JSON.stringify({ transactions: hexOps, firstOrDiscard: false });

      let adapter;
      let endpointUrl = this.nextFlashbaker!.endpoint!;
      if (endpointUrl.includes("https")) {
        adapter = https;
      } else {
        adapter = http;
      }
      const relayReq = adapter.request(
        endpointUrl, {
        method: 'POST',
        headers: {
          'User-Agent': 'Flashbake-Relay / 0.0.1',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bundleStr)
        }
      }, (bakerEndpointResp) => {
        const { statusCode } = bakerEndpointResp;

        if (statusCode != 200) {
          console.error(`Relay request to ${endpointUrl} failed with status code: ${statusCode}.`);
          bakerEndpointResp.resume();
        }

        var rawData = '';
        bakerEndpointResp.on('data', (chunk) => { rawData += chunk; });
        bakerEndpointResp.on('end', () => {
          //console.debug(`Received the following response from baker endpoint ${endpointUrl}: ${rawData}`);
        })
      })
      // relay transaction bundle to the remote flashbaker
      relayReq.write(bundleStr);
      relayReq.end();
    }).catch((reason) => {
      console.error(`Relaying operations failed: ${reason}`);
    })
  }

  onBlock(notification: BlockNotification): void {
    this.lastBlockLevel = notification.level;

    this.nextFlashbaker = this.bakingRightsService.getNextFlashbaker(notification.level + 1);
    this.taquitoService.getBlock('head').then((block) => {
      if (this.nextFlashbaker) {
        console.debug(`Baker of block level ${block.header.level} was ${block.metadata.baker}. Next Flashbaker at level ${this.nextFlashbaker.level}. Pending operations: ${Object.keys(this.operations).length}.`);
      } else {
        console.debug(`Baker of block level ${block.header.level} was ${block.metadata.baker}. No Flashbaker in the next TTL window.`);
      }

      for (var operations of block.operations) {
        // console.debug('Operation hashes:');
        for (var operation of operations) {
          // console.debug('\t' + operation.hash);

          // Remove any bundles found on-chain from pending resend queue
          if (operation.hash in this.operations) {
            console.info(`Relayed bundle identified by operation hash ${operation.hash} found on-chain.`);
            delete this.operations[operation.hash]

            // update metrics
            this.metricSuccessfulBundlesTotal.inc();
            this.metricPendingBundles.set(Object.keys(this.operations).length);
            if (!this.successfulBakersList.includes(block.metadata.baker)) {
              this.successfulBakersList.push(block.metadata.baker);
              this.metricSuccessfulBakersTotal.inc();
            }
          }
        }
      }

      // Delete any operations that have expired
      for (let opHash in this.operations) {
        if (!this.blockMonitor.getActiveHashes().includes(this.operations[opHash].branch)) {
          console.error(`Removing expired operation ${opHash}.`)
          delete this.operations[opHash]
          this.metricDroppedBundles.inc();
        }
      }
      // If next block is a flashbaker block, send bundles out
      if (Object.keys(this.operations).length > 0 && this.nextFlashbaker && this.nextFlashbaker.level == notification.level + 1) {
        this.relayBundle({ transactions: Object.values(this.operations), firstOrDiscard: false })
      }
    }).catch((reason) => {
      console.error(`Block head request failed: ${reason}`);
    })

  }

  /**
   * Implements the handler for Flashbake injection requests from Tezos RPC clients. When
   * request is received, a list of upcoming baking rights assignements is fetched from the
   * node. These bakers are then assessed against the Flashbake registry to identify the
   * earliest upcoming Flashbake-participating baker. The transaction is then forwarded to
   * the baker via their Flashbake bundle ingestion endpoint, as advertized in the registry.
   */
  private async injectionHandler(req: Request, res: Response) {
    const operation = JSON.parse(req.body);
    console.log("Flashbake operation received from client");
    // console.debug(`Hex - encoded operation content: ${ operation }`);
    TezosOperationUtils.parse(operation).then(async parsedOp => {
      try {
        parsedOp = await TezosOperationUtils.precheck(parsedOp, new RpcClient(this.rpcApiUrl), this.managerKeyCache, this.blockMonitor.getActiveHashes());
      } catch (e) {
        console.error(`Received an invalid operation. ${e}`);
        res.status(500).send(`Error ${e}`);
      }

      // update relevant metrics
      this.metricReceivedBundlesTotal.inc();


      // Retain operation in memory for re-relaying until observed on-chain
      const opHash = encodeOpHash(await TezosOperationUtils.operationToHex(parsedOp!));
      this.operations[opHash] = parsedOp!;

      if (this.nextFlashbaker && this.nextFlashbaker.level == this.lastBlockLevel + 1) {
        // if next baker is flashbaker, relay immediately
        this.relayBundle({ transactions: [parsedOp], firstOrDiscard: false })
      }
      res.status(200).json(opHash);

    })

  }

  private attachFlashbakeInjector() {
    this.express.post(HttpRelay.INJECT_URL_PATH, bodyParser.text({ type: "*/*" }), (req, res) => {
      this.injectionHandler(req, res);
    });
  }

  private attachRelayMetrics() {
    // prom.collectDefaultMetrics({ register: this.metrics, prefix: 'flashbake_' });

    this.express.get(HttpRelay.METRICS_URL_PATH, bodyParser.text({ type: "*/*" }), async (req, res) => {
      // res.send(await this.metrics.metrics())
      res.send(await prom.register.metrics());
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
    private readonly maxOperationTtl: number,
  ) {

    this.taquitoService = new TaquitoRpcService(rpcApiUrl);
    this.maxOperationTtl = maxOperationTtl;
    this.blockMonitor.addObserver(this);
    this.attachFlashbakeInjector();
    this.attachRelayMetrics();
    this.attachHttpProxy();
    this.managerKeyCache = {} as ManagerKeyCache;
  }
}
