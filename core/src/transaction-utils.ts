import { TezosParsedTransaction } from './types/tezos-parsed-transaction'
import bs58check from 'bs58check-ts';
import { LocalForger, ProtocolsHash } from '@taquito/local-forging';
const localForger = new LocalForger(ProtocolsHash.Psithaca2);

const TezosTransactionUtils = {
  /**
   * Determine if two `Bundle` objects are equal.
   * 
   * @param hexOperation: the hex encoded operation coming from the client
   * @returns A parsed Tezos Transaction
   */
  parse: (hexOperation: string): Promise<TezosParsedTransaction> => {
    let transactionWithoutSignature = hexOperation.slice(0, -128);
    let signature = hexOperation.slice(-128);
    let encodedSignature = bs58check.encode(Buffer.from("09f5cd8612" + signature, "hex"));
    return localForger.parse(transactionWithoutSignature).then(parsedTransactionNosig => {
        let parsedTransaction: TezosParsedTransaction = { "branch": parsedTransactionNosig.branch,
            "contents": parsedTransactionNosig.contents,
            "signature": encodedSignature,
        };
        return parsedTransaction;
    });
  }
}

export default TezosTransactionUtils
