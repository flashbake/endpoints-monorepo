import { Mempool, BlockNotification, BlockObserver, RpcBlockMonitor } from '@flashbake/relay';
import { RpcClient } from "@taquito/rpc";
import { Bundle, TezosTransactionUtils } from '@flashbake/core';
import { Express } from 'express';
import * as bodyParser from 'body-parser';
import { createProxyMiddleware } from 'http-proxy-middleware';
import * as http from "http";
const blake = require('blakejs');


interface ManagerKeyCache {
  [source: string]: string;
}
export default class HttpBakerEndpoint implements BlockObserver {
  readonly rpcClient: RpcClient;
  readonly managerKeyCache: ManagerKeyCache;


  /**
   * Implements baker's interface for Flashbake Relay to submit bundles for addition to the
   * Flashbake mempool. The mempool is accessed by the baker process via monitor_operations
   * request.
   */
  private attachBundleIngestor() {
    this.relayFacingApp.post('/flashbake/bundle', bodyParser.json(), async (req, res) => {
      try {
        const bundle = req.body as Bundle;
        const parsedTransactionsPromises = bundle.transactions.map((tx) => TezosTransactionUtils.parse(tx, this.rpcClient, this.managerKeyCache));

        // Wait for all transactions to be parsed
        await Promise.all(parsedTransactionsPromises);

        this.mempool.addBundle(bundle);
        this.mempool.getBundles().then((bundles) => {
          console.log(`Adding incoming bundle to Flashbake mempool. Number of bundles in pool: ${bundles.length}`);
        });
        res.sendStatus(200);
      } catch (e) {
        var message = e;
        if (e instanceof Error) {
          message = e.message;
        }
        console.error(message);
        res.status(500).send(message);
        return;
      } finally {
        res.end();
      }
    });
  }

  /**
   * Tezos baker can optionally query an external mempool with the `--operations-pool` parameter.
   * 
   * This method implements the handler for such baker's queries.
   * format). Returned transactions include the pending transactions from the
   * local Flashbake mempool.
   */
  private attachMempoolResponder() {
    this.bakerFacingApp.get('/operations-pool', (req, res) => {
      this.mempool.getBundles().then((bundles) => {
        if (bundles.length > 0) {
          Promise.all(
            bundles.map(
              bundle => TezosTransactionUtils.parse(bundle.transactions[0], this.rpcClient, this.managerKeyCache)
            )
          ).then((parsedBundles) => {
            console.debug(`Incoming operations-pool request from baker.`);
            // sort by fee for auction
            let sortedBundles = parsedBundles.sort(bundle => bundle.contents[0].fee);
            let highestFeeBundleIdx = parsedBundles.indexOf(sortedBundles.slice(-1)[0]);
            let highestFeeBundle = parsedBundles[highestFeeBundleIdx];
            console.debug(`Out of ${parsedBundles.length} bundles, #${highestFeeBundleIdx} is winning the auction with a fee of ${highestFeeBundle.contents[0].fee} mutez.`);
            console.debug("Exposing the following data to the external operations pool:");
            console.debug(JSON.stringify([highestFeeBundle], null, 2));
            res.send([highestFeeBundle]);
          });
        }
        else {
          res.send([]);
        }
      })
    }
    )
  }

  public onBlock(block: BlockNotification): void {
    // Flush the mempool whenever a new block is produced, since the relay will resend
    // all pending bundles to the appropriate baker prior to the next block.
    this.mempool.flush();
    console.debug(`Block ${block.level} found, mempool flushed.`);
  }

  /**
   * Create a new Baker Endpoint service on an Express webapp instance.
   * 
   * The service will set up Flashbake Baker Endpoint API handlers on the supplied Express app
   * instance. Express app lifecycle, including listening status, is controlled externally.
   * 
   * The purpose of the Baker Endpoint service is to provide an interface for Flashbake relay
   * to submit transaction bundles to Flashbake participating bakers. These bundles are entered
   * into the baker's Flashbake mempool, from where the baker process subsequently retrieves
   * them via a call to this service. 
   * 
   * The service does not provide access controls for Flashbake bundle submission or for
   * mempool fetch API call (/chains/main/mempool/monitor_operations). The latter in particular
   * allows Flashbake transactions with varying levels of privacy expectations to be accessed
   * by potentially unauthorized actors. Since this is counter to the privacy goals of the
   * Flashbake protocol, deployment-level access controls for mempool fetch API call should
   * be considered by service operators.
   * 
   * @param relayFacingApp Express app to which Flashbake Relay-facing API handlers will be added.
   * @param bakerFacingApp Express app to which baker-facing API handlers will be added.
   * @param mempool Memory pool of pending transaction bundles.
   * @param rpcApiUrl Endpoint URL of RPC service of a Tezos node.
   */
  public constructor(
    private readonly relayFacingApp: Express,
    private readonly bakerFacingApp: Express,
    private readonly mempool: Mempool,
    private readonly rpcApiUrl: string,
  ) {
    this.attachBundleIngestor();
    this.attachMempoolResponder();

    const blockMonitor = new RpcBlockMonitor(rpcApiUrl);
    this.rpcClient = new RpcClient(rpcApiUrl);
    this.managerKeyCache = {} as ManagerKeyCache;
    blockMonitor.addObserver(this);
    blockMonitor.start();
  }
}
