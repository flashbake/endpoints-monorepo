import CycleMonitor from "../../interfaces/cycle-monitor";
import GenericCycleMonitor from "../in-memory/generic-cycle-monitor";
import RpcBlockMonitor from "./rpc-block-monitor";
import ConstantsUtil from "./rpc-constants";


export default class RpcCycleMonitor extends GenericCycleMonitor implements CycleMonitor {
  private static async getMaxOperationsTtl(rpcApiUrl: string): Promise<number> {
    return ConstantsUtil.getConstant('max_operations_time_to_live', rpcApiUrl);
  }

  constructor(
    private readonly rpcApiUrl: string,
    private readonly rpcBlockMonitor: RpcBlockMonitor
  ) {
    super(RpcCycleMonitor.getMaxOperationsTtl(rpcApiUrl), rpcBlockMonitor);
  }
}
