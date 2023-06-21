#!/usr/bin/env node
import {
  BlockNotification, BlockObserver, BakingAssignment,
  RegistryService, BakingRightsService, BlockMonitor,
  TaquitoRpcService, OnChainRegistryService, RpcBlockMonitor,
  RpcTtlWindowMonitor, CachingBakingRightsService
} from '@flashbake/core';
import { TezosToolkit } from '@taquito/taquito'
import yargs, { Argv } from "yargs";

// The annotation of the big map in the registry contract
const REGISTRY_BIG_MAP_ANNOTATION = "registry"

export default class Flywheel implements BlockObserver {
  private lastBlockLevel = 0;
  // Next Flashbaker assignment
  private nextFlashbaker: BakingAssignment | undefined;
  private readonly bakingRightsService: BakingRightsService;
  private readonly tezos: TezosToolkit;
  onBlock(notification: BlockNotification): void {
    this.lastBlockLevel = notification.level;

    this.nextFlashbaker = this.bakingRightsService.getNextFlashbaker(notification.level + 1);
    this.tezos.rpc.getBlock({ block: 'head' }).then((block) => {
      if (this.nextFlashbaker) {
        console.debug(`Baker of block level ${block.header.level} was ${block.metadata.baker}. Next Flashbaker at level ${this.nextFlashbaker.level}.`);
      } else {
        console.debug(`Baker of block level ${block.header.level} was ${block.metadata.baker}. No Flashbaker in the next TTL window.`);
      }

    }).catch((reason) => {
      console.error(`Block head request failed: ${reason}`);
    })

  }
  public constructor(
    private readonly rpcApiUrl: string,
    private readonly registryContract: string,

  ) {

    const rpcService = new TaquitoRpcService(rpcApiUrl);
    this.tezos = new TezosToolkit(rpcApiUrl);
    const bakerRegistry = new OnChainRegistryService(rpcService, registryContract, REGISTRY_BIG_MAP_ANNOTATION);
    const blockMonitor = new RpcBlockMonitor(rpcApiUrl)
    this.bakingRightsService = new CachingBakingRightsService(
      rpcApiUrl,
      new RpcTtlWindowMonitor(rpcApiUrl, blockMonitor),
      blockMonitor,
      0, //maxRound
      bakerRegistry
    )
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
      })
    })
    .strictCommands()
    .demandCommand(1, 'You need to pass the run command, as in "flashbake-relay run"').argv;

  new Flywheel(argv.tezos_rpc_url as string, argv.registry_contract as string);
}

main();
