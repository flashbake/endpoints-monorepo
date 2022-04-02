import * as http from "http";
import { max } from "lodash";
import CycleMonitor from "../../interfaces/cycle-monitor";
import GenericCycleMonitor from "../in-memory/generic-cycle-monitor";
import RpcBlockMonitor from "./rpc-block-monitor";


export default class RpcCycleMonitor extends GenericCycleMonitor implements CycleMonitor {
  private static handleError(rpcApiUrl: string,
                        retryTimeout: number,
                        maxRetries: number,
                        message: string,
                        resolve: (value: number | PromiseLike<number>) => void,
                        reject: (reason?: any) => void)
  {
    console.error(`Constants request failed or response is invalid: ${message}`);
    if (maxRetries > 0) {
      setTimeout(() => {
        console.error(`Retrying constants request, retries left: ${--maxRetries}`);
        resolve(RpcCycleMonitor.getBlocksPerCycle(rpcApiUrl, retryTimeout, maxRetries));
      }, retryTimeout);
    } else {
      reject(`Error while fetching or parsing network constants: ${message}`);
    }
  }

  private static async getBlocksPerCycle(rpcApiUrl: string,
                                            retryTimeout = 1000,
                                            maxRetries = 100): Promise<number>
  {
    return new Promise((resolve, reject) => 
      http.get(`${rpcApiUrl}/chains/main/blocks/head/context/constants`, (resp) => {
        const { statusCode } = resp;
        const contentType = resp.headers['content-type'] || '';

        var error;
        if (statusCode !== 200) {
          error = new Error(`Constants request failed with status code: ${statusCode}.`);
        } else if (!/^application\/json/.test(contentType)) {
          error = new Error(`Constants request produced unexpected response content-type ${contentType}.`);
        }
        if (error) {
          resp.resume();
          reject(error.message);
          return;
        }

        // A chunk of data has been received.
        var rawData = '';
        resp.on('data', (chunk) => { rawData += chunk; });
        resp.on('end', () => {
          try {
            resolve((JSON.parse(rawData) as {blocks_per_cycle: number}).blocks_per_cycle);
          } catch (e) {
            var errMessage = (typeof e === "string") ? e : (e instanceof Error) ? e.message : '';
            this.handleError(rpcApiUrl, retryTimeout, maxRetries, errMessage, resolve, reject);
          }
        });
      }).on("error", (err) => {
        this.handleError(rpcApiUrl, retryTimeout, maxRetries, err.message, resolve, reject);
      })
    )
  }

  constructor(
    private readonly rpcApiUrl: string,
    private readonly rpcBlockMonitor: RpcBlockMonitor
  ) {
    super(RpcCycleMonitor.getBlocksPerCycle(rpcApiUrl), rpcBlockMonitor);
  }
}