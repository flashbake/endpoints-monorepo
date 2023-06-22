import { Mempool } from '.';
import { RpcClient } from "@taquito/rpc";
import {
  Bundle, TezosOperationUtils, TezosParsedOperation,
  BlockNotification, BlockObserver, BlockMonitor
} from '@flashbake/core';
import { Express } from 'express';
import * as bodyParser from 'body-parser';
import { encodeOpHash } from "@taquito/utils";


interface ManagerKeyCache {
  [source: string]: string;
}
export default class HttpBakerEndpoint implements BlockObserver {
  private readonly rpcClient: RpcClient;
  private readonly managerKeyCache: ManagerKeyCache;

  // pending "free" (non-priority) operations indexed by source
  private operations: { [index: string]: TezosParsedOperation } = {};
  // pending priority bundle
  private priorityOps: TezosParsedOperation[] = [];

  /**
   * Implements baker's interface for Flashbake Relay to submit bundles for addition to the
   * Flashbake mempool. The mempool is accessed by the baker process via monitor_operations
   * request.
   */
  private attachBundleIngestor() {
    this.relayFacingApp.post('/flashbake/bundle', bodyParser.json(), async (req, res) => {
      const parsedOperationsPromises = req.body.transactions.map((tx: string) =>
        TezosOperationUtils.parse(tx).then(tx =>
          TezosOperationUtils.precheck(tx, this.rpcClient, this.managerKeyCache, this.blockMonitor.getActiveHashes())
        )
      )

      // Wait for all transactions to be parsed
      Promise.all(parsedOperationsPromises).then(parsedOps => {
        // check if parsed operations have duplicate source in contents
        let managersPkh = parsedOps.map(op => op.contents[0].source)
        // send error if there are duplicates
        let duplicates = managersPkh.filter((item, index) => managersPkh.indexOf(item) != index);

        if (duplicates.length > 0) {
          res.status(500).send("Found more than one operation signed by the same manager in the bundle. This violates 1M and is invalid.");
        }

        let firstOrDiscard = req.body.firstOrDiscard || false;
        if (firstOrDiscard) {
          console.log(`Incoming valid FIRST_OR_DISCARD bundle with ${parsedOps.length} operations. Running auction.`);
          this.addPriorityOps(parsedOps);
          // TODO
        } else {
          console.log(`Incoming valid ANY_POSITION bundle with ${parsedOps.length} operations. `);
          parsedOps.forEach(op => {
            this.addOp(op);
          })
        }
        return res.sendStatus(200);
      }
      ).catch((err) => {
        console.log(`Error processing incoming bundle: ${err}`)
        res.status(500).send(err);
      })
    });
  }

  /**
   * Tezos baker can optionally query an external mempool with the `--operations-pool` parameter.
   * 
   * This method implements the handler for such baker's queries.
   * Returned transactions include the pending transactions from the
   * local Flashbake mempool.
   */
  private attachMempoolResponder() {
    this.bakerFacingApp.get('/operations-pool', (req, res) => {
      let opsToInclude = this.priorityOps;
      let priorityOpsSources = opsToInclude.map((op) => op.contents[0].source)
      Object.values(this.operations).forEach((op) => {
        // Add non-priority operations after checking there is no duplicate sender
        // from priority operations.
        let source: string = op.contents[0].source;
        if (!(source in priorityOpsSources)) {
          opsToInclude.push(op);
        }
      })
      console.debug("Incoming operations-pool request from baker. Exposing the following data:");
      console.debug(JSON.stringify(opsToInclude, null, 2));
      res.send(opsToInclude);
    }
    )
  }
  private async addOp(parsedOp: TezosParsedOperation): Promise<string> {
    const opHash = encodeOpHash(await TezosOperationUtils.operationToHex(parsedOp!));
    this.operations[opHash] = parsedOp!;
    // TODO implement proper "replace" and only replace if the fee is higher.
    // For now we always replace an old op with a new op from the same source.
    return opHash;
  }
  private addPriorityOps(ops: TezosParsedOperation[]): void {
    // FIXME; for now, always override
    this.priorityOps = ops;
  }

  public onBlock(block: BlockNotification): void {
    // Flush the mempool whenever a new block is produced, since the relay will resend
    // all pending bundles to the appropriate baker prior to the next block.
    this.operations = {};
    this.priorityOps = [];
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
    private readonly blockMonitor: BlockMonitor,
    private readonly rpcApiUrl: string,
  ) {
    this.attachBundleIngestor();
    this.attachMempoolResponder();

    this.rpcClient = new RpcClient(rpcApiUrl);
    this.managerKeyCache = {} as ManagerKeyCache;
    this.blockMonitor.addObserver(this);
  }
}
