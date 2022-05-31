import CycleMonitor from "../../interfaces/cycle-monitor";
import GenericCycleMonitor from "../in-memory/generic-cycle-monitor";
import RpcBlockMonitor from "./rpc-block-monitor";
import ConstantsUtil from "./rpc-constants";


export default class RpcCycleMonitor extends GenericCycleMonitor implements CycleMonitor {
  private static async getBlocksPerCycle(rpcApiUrl: string): Promise<number>
  {
    return ConstantsUtil.getConstant('blocks_per_cycle', rpcApiUrl);
  }

  constructor(
    private readonly rpcApiUrl: string,
    private readonly rpcBlockMonitor: RpcBlockMonitor
  ) {
    super(RpcCycleMonitor.getBlocksPerCycle(rpcApiUrl), rpcBlockMonitor);
  }
}