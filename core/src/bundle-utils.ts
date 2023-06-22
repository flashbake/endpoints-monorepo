import { TezosParsedOperation, TezosOperationUtils } from '.'
import _ from "lodash"
import { Bundle } from './types/bundle'
import * as http from "http";
import * as https from "https";

/** Helper functions for working with `Bundle` objects */
const BundleUtils = {
  /**
   * Determine if two `Bundle` objects are equal.
   * 
   * @param a The first `Bundle`
   * @param b The second `Bundle`
   * @returns A boolean indicating if the two `Bundle`s are equivalent.
   */
  isEqual: (a: Bundle, b: Bundle): boolean => {
    return _.isEqual(a, b)
  },
  relayBundle(bundle: Bundle, endpointUrl: string) {
    // Bundles are sending hex formatted transactions to the wire, doing the conversion here.
    let hexOps: Promise<string>[] = [];
    bundle.transactions.forEach(op => {
      hexOps.push(TezosOperationUtils.operationToHex(op as TezosParsedOperation));
    })
    Promise.all(hexOps).then(hexOps => {
      console.log(`Sending bundle ${JSON.stringify(hexOps.map((op) => op.substring(0, 6) + ".."))} to Flashbaker with "any position" flag.`)
      const bundleStr = JSON.stringify({ transactions: hexOps, firstOrDiscard: bundle.firstOrDiscard });

      let adapter;
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
}

export default BundleUtils
