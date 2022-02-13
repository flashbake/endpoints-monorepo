import * as http from "http";
import CycleMonitor from "../../interfaces/cycle-monitor";
import GenericCycleMonitor from "../in-memory/generic-cycle-monitor";
import RpcBlockMonitor from "./rpc-block-monitor";


export default class RpcCycleMonitor extends GenericCycleMonitor implements CycleMonitor {
  private static async getBlocksPerCycle(rpcApiUrl: string,
                                            retryTimeout = 1000,
                                            maxRetries = 100): Promise<number>
  {
    return new Promise(async (resolve, reject) => {
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
            if (typeof e === "string") {
              reject(e);
            } else if (e instanceof Error) {
              reject(e.message);
            }
          }
        });
        }).on("error", (err) => {
          console.error("Constants request failed: " + err.message);
          if (maxRetries > 0) {
            setTimeout(() => {
              console.error(`Retrying constants request, retries left: ${--maxRetries}`);
              return this.getBlocksPerCycle(rpcApiUrl, retryTimeout, maxRetries);
            }, retryTimeout);
          } else {
            reject(`Error while getting constants:  + err.message`);
          }
        });
    })
  }

  constructor(
    private readonly rpcApiUrl: string,
    private readonly rpcBlockMonitor: RpcBlockMonitor
  ) {
    super(RpcCycleMonitor.getBlocksPerCycle(rpcApiUrl), rpcBlockMonitor);
  }
}