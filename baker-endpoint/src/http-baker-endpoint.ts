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
   * Implements baker's interface for Flashbake Relay to submit bundles for addition to the
   * Flashbake mempool. The mempool is accessed by the baker process via monitor_operations
   * request.
   */
  private attachBundleIngestor() {
    this.relayFacingApp.post('/flashbake/bundle', bodyParser.json(), (req, res) => {
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
   * Tezos baker can optionally query an external mempool with the `--operations-pool` parameter.
   * 
   * This method implements the handler for such baker's queries.
   * format). Returned transactions include the pending transactions from the
   * local Flashbake mempool.
   */
  private attachMempoolResponder() {
    this.bakerFacingApp.get('/operations-pool', (req, res) => {
      http.get(`${this.rpcApiUrl}/chains/main/mempool/monitor_operations`,
        {headers: {'accept': 'application/octet-stream' }},
        (resp) => {
              if (bundles.length > 0) {
                console.debug("Found a bundle in flashbake special mempool");
                res.write(bundle);
                this.mempool.removeBundle(bundles[0]);
              }
              else {
                  res.write([]);
              }
            });
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
  }
}
