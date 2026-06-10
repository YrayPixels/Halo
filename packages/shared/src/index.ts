export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function optionalEnv(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const REDIS_KEYS = {
  networkCurrentSlot: "network:current_slot",
} as const;

export {
  CommitmentLevel,
  createYellowstoneClient,
  writeSubscribeRequest,
} from "./yellowstone.js";
export type {
  ClientDuplexStream,
  SubscribeRequest,
  SubscribeUpdate,
  YellowstoneClient,
} from "./yellowstone.js";
