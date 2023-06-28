import * as http from "http";


export default class ConstantsUtil {
  private static constants: Promise<any> | null;

  private static handleError(rpcApiUrl: string,
    retryTimeout: number,
    maxRetries: number,
    message: string,
    resolve: (value: any) => void,
    reject: (reason?: any) => void) {
    console.error(message);
    if (maxRetries > 0) {
      setTimeout(() => {
        console.error(`Retrying constants request, retries left: ${--maxRetries}`);
        ConstantsUtil.constants = null;
        resolve(ConstantsUtil.getConstants(rpcApiUrl, retryTimeout, maxRetries));
      }, retryTimeout);
    } else {
      reject(`Error while fetching or parsing network constants: ${message}`);
    }
  }

  private static async getConstants(rpcApiUrl: string,
    retryTimeout: number,
    maxRetries: number): Promise<any> {
    if (!ConstantsUtil.constants) {
      ConstantsUtil.constants = new Promise((resolve, reject) => {
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
            this.handleError(rpcApiUrl, retryTimeout, maxRetries, error.message, resolve, reject);
            return;
          }

          // A chunk of data has been received.
          var rawData = '';
          resp.on('data', (chunk) => { rawData += chunk; });
          resp.on('end', () => {
            try {
              const constants = JSON.parse(rawData);
              console.debug(`${Object.keys(constants).length} constants retrieved.`);
              resolve(constants);
            } catch (e) {
              var errMessage = (typeof e === "string") ? e : (e instanceof Error) ? e.message : '';
              this.handleError(rpcApiUrl, retryTimeout, maxRetries, errMessage, resolve, reject);
            }
          });
        }).on("error", (err) => {
          this.handleError(rpcApiUrl, retryTimeout, maxRetries, err.message, resolve, reject);
        })
      });
    }

    return ConstantsUtil.constants;
  }

  public static async getConstant(constant: string,
    rpcApiUrl: string,
    retryTimeout = 1000,
    maxRetries = 1000): Promise<any> {
    return new Promise((resolve, reject) => {
      ConstantsUtil.getConstants(rpcApiUrl, retryTimeout, maxRetries)
        .then((constants) => {
          if (constant) {
            if (constant in constants) {
              resolve(constants[constant]);
            } else {
              resolve(null);
            }
          } else {
            resolve(constants);
          }
        })
        .catch((reason) => reject(reason));
    })
  }
}
