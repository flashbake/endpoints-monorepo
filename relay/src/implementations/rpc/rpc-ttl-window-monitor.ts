import TtlWindowMonitor from "../../interfaces/ttl-window-monitor";
import GenericTtlWindowMonitor from "../in-memory/generic-ttl-window-monitor";
import RpcBlockMonitor from "./rpc-block-monitor";
import ConstantsUtil from "./rpc-constants";


export default class RpcTtlWindowMonitor extends GenericTtlWindowMonitor implements TtlWindowMonitor {
  private static async getMaxOperationsTtl(rpcApiUrl: string): Promise<number> {
    return ConstantsUtil.getConstant('max_operations_time_to_live', rpcApiUrl);
  }

  constructor(
    private readonly rpcApiUrl: string,
    private readonly rpcBlockMonitor: RpcBlockMonitor
  ) {
    super(RpcTtlWindowMonitor.getMaxOperationsTtl(rpcApiUrl), rpcBlockMonitor);
  }
}
