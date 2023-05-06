import { TezosParsedTransaction } from './types/tezos-parsed-transaction'
import bs58check from 'bs58check-ts';
import { LocalForger, ProtocolsHash } from '@taquito/local-forging';
import { RpcClient } from '@taquito/rpc';
import { verifySignature } from '@taquito/utils';
const localForger = new LocalForger(ProtocolsHash.PtMumbai2);

const TezosTransactionUtils = {
  parse: (hexOperation: string, rpcClient: RpcClient): Promise<TezosParsedTransaction> => {
    return new Promise(async (resolve, reject) => {
      let transactionWithoutSignature = hexOperation.slice(0, -128);
      let signature = hexOperation.slice(-128);
      let encodedSignature = bs58check.encode(Buffer.from("09f5cd8612" + signature, "hex"));

      try {
        const parsedTransactionNosig = await localForger.parse(transactionWithoutSignature);

        await Promise.all(parsedTransactionNosig.contents.map(async c => {
          if (c.kind == "transaction") {
            const pk = await rpcClient.getManagerKey(c.source);
            if (pk) {
              if (!verifySignature("03" + transactionWithoutSignature, pk.toString(), encodedSignature)) {
                reject("Signature invalid!");
              }
            } else {
              reject("Unrevealed source address!");
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
