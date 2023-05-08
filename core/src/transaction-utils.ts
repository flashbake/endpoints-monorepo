import { TezosParsedTransaction } from './types/tezos-parsed-transaction'
import bs58check from 'bs58check-ts';
import { LocalForger, ProtocolsHash } from '@taquito/local-forging';
import { RpcClient } from '@taquito/rpc';
import { verifySignature } from '@taquito/utils';
const localForger = new LocalForger(ProtocolsHash.PtMumbai2);


interface ManagerKeyCache {
  [source: string]: string;
}
const TezosTransactionUtils = {

  parse: (hexOperation: string, rpcClient: RpcClient, managerKeyCache: ManagerKeyCache): Promise<TezosParsedTransaction> => {
    return new Promise(async (resolve, reject) => {
      let transactionWithoutSignature = hexOperation.slice(0, -128);
      let signature = hexOperation.slice(-128);
      let encodedSignature = bs58check.encode(Buffer.from("09f5cd8612" + signature, "hex"));

      try {
        const parsedTransactionNosig = await localForger.parse(transactionWithoutSignature);

        // check if any of the transactions contains one of kind "reveal"
        let containsReveal = (parsedTransactionNosig.contents.map((c: any) => c.kind).includes("reveal"));

        await Promise.all(parsedTransactionNosig.contents.map(async c => {
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
              if (!verifySignature("03" + transactionWithoutSignature, pk.toString(), encodedSignature)) {
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

        const parsedTransaction: TezosParsedTransaction = {
          "branch": parsedTransactionNosig.branch,
          "contents": parsedTransactionNosig.contents,
          "signature": encodedSignature,
        };
        resolve(parsedTransaction);

      } catch (err) {
        reject(err);
      }
    });
  }
}

export default TezosTransactionUtils
