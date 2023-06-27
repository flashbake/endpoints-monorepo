#!/usr/bin/env node
import {
  BlockNotification, BlockObserver, BakingAssignment,
  BakingRightsService, ConstantsUtil,
  TaquitoRpcService, OnChainRegistryService, RpcBlockMonitor,
  RpcTtlWindowMonitor, CachingBakingRightsService,
  Bundle, TezosOperationUtils, BundleUtils
} from '@flashbake/core';
import { TezosToolkit, createTransferOperation } from '@taquito/taquito'
import { LocalForger, ProtocolsHash, ForgeParams } from '@taquito/local-forging';
import { InMemorySigner, importKey } from '@taquito/signer';
import { encodeOpHash } from '@taquito/utils';
import yargs, { Argv } from "yargs";

const localForger = new LocalForger(ProtocolsHash.PtMumbai2);
// The annotation of the big map in the registry contract
const REGISTRY_BIG_MAP_ANNOTATION = "registry"

export default class Flywheel implements BlockObserver {
  private lastBlockLevel = 0;
  // Next Flashbaker assignment
  private nextFlashbaker: BakingAssignment | undefined;
  private readonly bakingRightsService: BakingRightsService;
  private readonly tezos: TezosToolkit;

  // 2 tez per day, 2/5760
  private flywheelLastSuccessfulTransferLevel: number = -1;
  private flywheelCurrentTransferHash: string = "";
  onBlock(notification: BlockNotification): void {
    this.lastBlockLevel = notification.level;


    this.nextFlashbaker = this.bakingRightsService.getNextFlashbaker(notification.level + 1);
    this.tezos.rpc.getBlock({ block: 'head' }).then((block) => {
      if (this.nextFlashbaker) {
        console.debug(`Baker of block level ${block.header.level} was ${block.metadata.baker}. Next Flashbaker at level ${this.nextFlashbaker.level}.`);
        if (block.header.level + 1 != this.nextFlashbaker.level) {
          return
        }
      } else {
        console.debug(`Baker of block level ${block.header.level} was ${block.metadata.baker}. No Flashbaker in the next TTL window.`);
        return
      }

      // next block is flashbake block, send bribe to baker

      const amount = parseFloat(
        (this.perBlockBribe / 1000000 * (this.lastBlockLevel + 1 - this.flywheelLastSuccessfulTransferLevel))
          .toFixed(6)
      )
      console.log(`Sending ${amount} to Flashbaker as a bribe.`)
      this.forgeSignFlywheelTx(amount).then(async signedOp => {

        const flywheelBundle: Bundle = {
          transactions: [await TezosOperationUtils.parse(signedOp)],
          firstOrDiscard: true
        };

        BundleUtils.relayBundle(flywheelBundle, this.nextFlashbaker!.endpoint!);
        this.flywheelCurrentTransferHash = encodeOpHash(signedOp);

      }).catch(error => {
        console.error(error);
        return false
      })

    }).catch((reason) => {
      console.error(`Block head request failed: ${reason}`);
    })

  }
  async forgeSignFlywheelTx(amount: number): Promise<string> {

    function taquitoToString(object: any): object {
      const keys = Object.keys(object);
      keys.forEach(key => {
        if (typeof object[key] === 'object') {
          return taquitoToString(object[key]);
        }

        object[key] = '' + object[key];
      });

      return object;
    }
    const transferParams = { to: this.nextFlashbaker!.delegate, amount: amount };
    const estimate = await this.tezos.estimate.transfer(transferParams);
    const rpcTransferOperation = await createTransferOperation({
      ...transferParams,
      fee: estimate.suggestedFeeMutez,
      gasLimit: estimate.gasLimit,
      storageLimit: estimate.storageLimit,
    })
    delete rpcTransferOperation.parameters;

    const source = await this.tezos.signer.publicKeyHash();
    const { hash } = await this.tezos.rpc.getBlockHeader();
    const { counter } = await this.tezos.rpc.getContract(source);
    const op = {
      branch: hash,
      contents: [{
        ...rpcTransferOperation,
        source,
        counter: parseInt(counter || '0', 10) + 1,
      }]
    }

    let forgedOp = await localForger.forge(taquitoToString(op) as ForgeParams);
    // We sign the operation
    let signedOp = await this.tezos.signer.sign(forgedOp, new Uint8Array([3]));
    return signedOp.sbytes;
  }
  public constructor(
    private readonly rpcApiUrl: string,
    private readonly registryContract: string,
    private readonly perBlockBribe: number,

  ) {

    const rpcService = new TaquitoRpcService(rpcApiUrl);
    this.perBlockBribe = perBlockBribe;
    this.tezos = new TezosToolkit(rpcApiUrl);
    const bakerRegistry = new OnChainRegistryService(rpcService, registryContract, REGISTRY_BIG_MAP_ANNOTATION);
    bakerRegistry.initialize()
    const blockMonitor = new RpcBlockMonitor(rpcApiUrl)
    this.bakingRightsService = new CachingBakingRightsService(
      rpcApiUrl,
      new RpcTtlWindowMonitor(rpcApiUrl, blockMonitor),
      blockMonitor,
      0, //maxRound
      bakerRegistry
    )
    let maxOperationTtl = ConstantsUtil.getConstant('max_operations_time_to_live', rpcApiUrl).then((maxOperationTtl) => {
      blockMonitor.start(maxOperationTtl);

    })
    this.tezos.setProvider({
      signer: new InMemorySigner(process.env['FLYWHEEL_SK']!),
    });
    blockMonitor.addObserver(this);
  }
}
async function main() {
  let argv = await yargs
    .scriptName("flashbake-flywheel")
    .command('run', "Start Flashbake Flywheel.", (yargs: Argv) => {
      return yargs.option('registry_contract', {
        describe: "Registry contract address",
        type: "string",
        demandOption: true,
      }).option('tezos_rpc_url', {
        describe: "Tezos node RPC API URL",
        type: "string",
        demandOption: true,
      }).option('per_block_bribe', {
        describe: "Flywheel bribe per block in mutez",
        type: "number",
        demandOption: true,
      })
    })
    .strictCommands()
    .demandCommand(1, 'You need to pass the run command, as in "flashbake-relay run"').argv;

  new Flywheel(argv.tezos_rpc_url as string, argv.registry_contract as string, argv.per_block_bribe as number);
}

main();
