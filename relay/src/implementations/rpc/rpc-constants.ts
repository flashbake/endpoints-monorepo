import * as http from "http";


export default class ConstantsUtil {
  private static constants: any;

  private static handleError(constant: string,
                              rpcApiUrl: string,
                              retryTimeout: number,
                              maxRetries: number,
                              message: string,
                              resolve: (value: any) => void,
                              reject: (reason?: any) => void)
  {
    console.error(message);
    if (maxRetries > 0) {
      setTimeout(() => {
        console.error(`Retrying constants request, retries left: ${--maxRetries}`);
        resolve(ConstantsUtil.getConstant(constant, rpcApiUrl, retryTimeout, maxRetries));
      }, retryTimeout);
    } else {
      reject(`Error while fetching or parsing network constants: ${message}`);
    }
  }

  public static async getConstant(constant: string,
                                    rpcApiUrl: string,
                                    retryTimeout = 1000,
                                    maxRetries = 1000): Promise<any>
  {
    return new Promise((resolve, reject) => {
      if (!ConstantsUtil.constants) {
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
            this.handleError(constant, rpcApiUrl, retryTimeout, maxRetries, error.message, resolve, reject);
            return;
          }

          // A chunk of data has been received.
          var rawData = '';
          resp.on('data', (chunk) => { rawData += chunk; });
          resp.on('end', () => {
            try {
              ConstantsUtil.constants = JSON.parse(rawData);
            } catch (e) {
              var errMessage = (typeof e === "string") ? e : (e instanceof Error) ? e.message : '';
              this.handleError(constant, rpcApiUrl, retryTimeout, maxRetries, errMessage, resolve, reject);
            }
          });
        }).on("error", (err) => {
          this.handleError(constant, rpcApiUrl, retryTimeout, maxRetries, err.message, resolve, reject);
        })
      } else {
        if (constant) {
          if (constant in ConstantsUtil.constants) {
            resolve(ConstantsUtil.constants[constant]);
          } else {
            resolve(null);
          }
        } else {
          resolve(ConstantsUtil.constants);
        }
      }
    })
  }
}