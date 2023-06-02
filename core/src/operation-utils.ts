import { TezosParsedOperation } from './types/tezos-parsed-operation'
import bs58check from 'bs58check-ts';
import { LocalForger, ProtocolsHash } from '@taquito/local-forging';
import { RpcClient } from '@taquito/rpc';
import { verifySignature } from '@taquito/utils';
const localForger = new LocalForger(ProtocolsHash.PtMumbai2);


interface ManagerKeyCache {
  [source: string]: string;
}
const TezosOperationUtils = {

  parse(hexOperation: string): Promise<TezosParsedOperation> {
    return new Promise(async (resolve, reject) => {
      try {
        let unsignedOp = hexOperation.slice(0, -128);
        let signature = hexOperation.slice(-128);
        let encodedSignature = bs58check.encode(Buffer.from("09f5cd8612" + signature, "hex"));
        let tezosParsedOperation = await localForger.parse(unsignedOp);
        resolve({
          contents: tezosParsedOperation.contents,
          signature: encodedSignature,
          branch: tezosParsedOperation.branch,
        })
      } catch (err) {
        reject(err);
      }
    })
  },
  async operationToHex(parsedOp: TezosParsedOperation): Promise<string> {
    let signature = parsedOp.signature;
    let decodedSignature = bs58check.decode(signature).toString("hex").slice(10);
    return `${await localForger.forge(parsedOp)}${decodedSignature}`;
  },

  precheck: (parsedOp: TezosParsedOperation, rpcClient: RpcClient, managerKeyCache: ManagerKeyCache, blockHashes: string[]): Promise<TezosParsedOperation> => {
    // This verifies that:
    // * the signature is valid,
    // * the operation has not expired
    return new Promise(async (resolve, reject) => {

      try {

        // check if any of the transactions contains one of kind "reveal"
        let containsReveal = (parsedOp.contents.map((c: any) => c.kind).includes("reveal"));

        await Promise.all(parsedOp.contents.map(async c => {
          async function getManagerKeyWithCache(source: string, rpcClient: RpcClient, managerKeyCache: ManagerKeyCache): Promise<string | null> {
            if (managerKeyCache[source]) {
              return managerKeyCache[source];
            } else {
              const managerKey = await rpcClient.getManagerKey(source);
              if (managerKey) {
                managerKeyCache[source] = managerKey.toString();
                return managerKey.toString();
              } else {
                return null;
              }
            }
          };
          if (c.kind == "transaction") {
            const pk = await getManagerKeyWithCache(c.source, rpcClient, managerKeyCache);

            if (pk) {
              if (!verifySignature("03" + await localForger.forge(parsedOp), pk.toString(), parsedOp.signature)) {
                reject("Signature invalid!");
              }
            } else {
              if (!containsReveal) {
                reject("Unrevealed source address!");
              }
              // FIXME. If there is a reveal in the operation, we should check the signature as well.
            }
          }
        }));

        if (!blockHashes.includes(parsedOp.branch)) {
          reject("Transaction has expired")
        }


        resolve(parsedOp);

      } catch (err) {
        reject(err);
      }
    });
  }
}

export default TezosOperationUtils
