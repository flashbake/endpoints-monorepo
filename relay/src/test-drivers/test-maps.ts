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

  const bigMapId = await taquito.getBigMapIdentifier(contractAddress, annotation)
  console.log(`The big map ID with annotation ${annotation} at ${contractAddress} is ${bigMapId}`)

  const bigMapData: Map<string, any> = await rpc.getAllBigMapData<string, object>(bigMapId)

  const randomAddress = `tz1WjjwkLRwfJ7pn6oQRCpKynDk2ytBAsxmf`
  console.log(`There are ${bigMapData.size} entries in the big map`)
  console.log(`The balance of ${randomAddress} is ${bigMapData.get(randomAddress)['balance']}`)
}
main()