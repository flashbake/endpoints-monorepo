import { Mempool } from '@flashbake/relay';
import { Bundle } from '@flashbake/core';
import { Express } from 'express';
import * as bodyParser from 'body-parser';
import { createProxyMiddleware } from 'http-proxy-middleware';
import * as http from "http";

const dump = require('buffer-hexdump');
const blake = require('blakejs');


export default class HttpBakerEndpoint {

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
   * Implements baker's interface for Flashbake Relay to submit bundles for addition to the
   * Flashbake mempool. The mempool is accessed by the baker process via monitor_operations
   * request.
   */
  private attachBundleIngestor() {
    this.express.post('/flashbake/bundle', bodyParser.json(), (req, res) => {
      try {
        const bundle = req.body as Bundle;
        console.log("Adding bundle to Flashbake mempool");      
        this.mempool.addBundle(bundle);
        res.sendStatus(200);
      } catch(e) {
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
   * Node RPC provides an interface through which the baker queries the node's active mempool.
   * Flashbake-relayed transactions are pooled in this endpoint's mempool, hence it provides
   * a replacement for this mempool access interface to allow the baker access to Flashbake
   * mempool.
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
                console.debug("Found a bundle in flashbake special mempool, injecting the first transaction");
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
   * All operations that are not handled by this baker endpoint are proxied
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
   * @param express The Express app to which Baker Endpoint API handlers will be added.
   * @param mempool Memory pool of pending transaction bundles.
   * @param rpcApiUrl Endpoint URL of RPC service of a Tezos node.
   */
  public constructor(
    private readonly express: Express,
    private readonly mempool: Mempool,
    private readonly rpcApiUrl: string,
  ) {
    this.attachBundleIngestor();
    this.attachMempoolResponder();
    this.attachHttpProxy();
  }
}