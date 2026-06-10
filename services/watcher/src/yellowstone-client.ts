import { createRequire } from "node:module";
import type { ClientDuplexStream, SubscribeRequest } from "@triton-one/yellowstone-grpc";

export { CommitmentLevel } from "@triton-one/yellowstone-grpc";
export type { ClientDuplexStream, SubscribeRequest, SubscribeUpdate } from "@triton-one/yellowstone-grpc";

const require = createRequire(import.meta.url);

export interface YellowstoneClient {
  connect(): Promise<void>;
  subscribe(request?: SubscribeRequest): Promise<ClientDuplexStream>;
}

export function createYellowstoneClient(
  endpoint: string,
  token: string | undefined,
  reconnect = true,
): YellowstoneClient {
  const Client = require("@triton-one/yellowstone-grpc").default as new (
    endpoint: string,
    xToken: string | undefined,
    channelOptions: undefined,
    reconnectOptions?: { enabled?: boolean },
  ) => YellowstoneClient;

  return new Client(endpoint, token, undefined, { enabled: reconnect });
}
