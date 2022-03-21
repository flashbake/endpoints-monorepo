/** Simple tes driver for maps */

import { Network } from '@flashbake/core'
import TzktIndexerService from '../implementations/tzkt/tzkt-indexer-service'
import TaquitoRpcService from '../implementations/taquito/taquito-rpc-service'

const main = async () => {
  console.log("Resolving a balance from the kUSD contract...")

  const contractAddress = 'KT1K9gCRgaLRFKTErYt1wVxA3Frb9FjasjTV'
  const annotation = 'balances'

  const nodeUrl = "https://mainnet.smartpy.io"
  const baseUrl = "https://api.tzkt.io/v1"
  const rpc = new TzktIndexerService(Network.Mainnet)
  const taquito = new TaquitoRpcService(nodeUrl)

  const randomAddress = `tz1WjjwkLRwfJ7pn6oQRCpKynDk2ytBAsxmf`
  const value = await taquito.getBigMapValue(contractAddress, annotation, randomAddress)
  console.log(`The balance of ${randomAddress} is ${value['balance']}`)
}
main()