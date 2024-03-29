#!/usr/bin/env node
import express from 'express';
import {
  HttpRelay,
} from '.';
import {
  CachingBakingRightsService, RpcBlockMonitor, ConstantsUtil,
  RpcTtlWindowMonitor, OnChainRegistryService, TaquitoRpcService
} from '@flashbake/core';

require('trace-unhandled/register');


import yargs, { Argv } from "yargs";


// The annotation of the big map in the registry contract
const REGISTRY_BIG_MAP_ANNOTATION = "registry"

async function startRelay(port: number, rpcApiUrl: string, registryContract: string): Promise<HttpRelay> {
  // Identify the big map to read data from.
  console.log(`Starting relay connected to node ${rpcApiUrl}`)

  const rpcService = new TaquitoRpcService(rpcApiUrl);
  const bakerRegistry = new OnChainRegistryService(rpcService, registryContract, REGISTRY_BIG_MAP_ANNOTATION);
  bakerRegistry.initialize()

  // Read all rights for the ttlWindow
  const blockMonitor = new RpcBlockMonitor(rpcApiUrl)
  const bakingRightsService = new CachingBakingRightsService(
    rpcApiUrl,
    new RpcTtlWindowMonitor(rpcApiUrl, blockMonitor),
    blockMonitor,
    0, //maxRound
    bakerRegistry
  )


  let maxOperationTtl = await ConstantsUtil.getConstant('max_operations_time_to_live', rpcApiUrl);
  const relayApp = express();
  const relayer = new HttpRelay(relayApp, bakerRegistry, rpcApiUrl, bakingRightsService, blockMonitor, maxOperationTtl);
  const server = relayApp.listen(port, () => {
    blockMonitor.start(maxOperationTtl);
    console.log(`Flashbake relay started on http://localhost:${port}`);
  });
  server.setTimeout(500000);

  return relayer;
}

async function main() {
  let argv = await yargs
    .scriptName("flashbake-relay")
    .command('run', "Start Flashbake relay.", (yargs: Argv) => {
      return yargs.option('registry_contract', {
        describe: "Registry contract address",
        type: "string",
        demandOption: true,
      }).option('tezos_rpc_url', {
        describe: "Tezos node RPC API URL",
        type: "string",
        demandOption: true,
      }).option('relay_port', {
        describe: "The port the relay is listening to",
        type: "number",
        demandOption: true,
      })
    })
    .strictCommands()
    .demandCommand(1, 'You need to pass the run command, as in "flashbake-relay run"').argv;

  startRelay(argv.relay_port, argv.tezos_rpc_url, argv.registry_contract);
}

main();
