#!/usr/bin/env node
import express from 'express';
import { RpcBlockMonitor, ConstantsUtil } from '@flashbake/core';
import { HttpBakerEndpoint } from '.';
import yargs, { Argv } from "yargs";

function startBakerEndpoint(relayListenerPort: number, bakerListenerPort: number, rpcApiUrl: string, bakerPubkey: string): HttpBakerEndpoint {
  const relayFacingApp = express();
  const bakerFacingApp = express();
  const blockMonitor = new RpcBlockMonitor(rpcApiUrl)
  ConstantsUtil.getConstant('max_operations_time_to_live', rpcApiUrl).then((maxOperationTtl) => {
    blockMonitor.start(maxOperationTtl);
  });
  const baker = new HttpBakerEndpoint(relayFacingApp, bakerFacingApp, blockMonitor, rpcApiUrl, bakerPubkey);

  relayFacingApp.listen(relayListenerPort, () => {
    console.log(`Baker Endpoint relay-facing listener started on http://localhost:${relayListenerPort}`);
  }).setTimeout(500000);
  bakerFacingApp.listen(bakerListenerPort, () => {
    console.log(`Baker Endpoint baker-facing listener started on http://localhost:${bakerListenerPort}`);
  }).setTimeout(500000);

  return baker;
}

async function main() {
  let argv = await yargs
    .scriptName("flashbake-baker-endpoint")
    .command('run', "Start Flashbake baker-endpoint.", (yargs: Argv) => {
      return yargs.option('relay_listener_port', {
        describe: "Relay listener port",
        type: "number",
        demandOption: true,
      }).option('tezos_rpc_url', {
        describe: "Tezos node RPC API URL",
        type: "string",
        demandOption: true,
      }).option('baker_listener_port', {
        describe: "Baker listener port",
        type: "number",
        demandOption: true,
      }).option('baker_pkh', {
        describe: "Baker public key hash starting with tz",
        type: "string",
        demandOption: true,
      })
    })
    .strictCommands()
    .demandCommand(1, 'You need to pass the run command, as in "flashbake-baker-endpoint run"').argv;

  startBakerEndpoint(argv.relay_listener_port, argv.baker_listener_port, argv.tezos_rpc_url, argv.baker_pkh);
}

main();
