import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { requireEnv } from "@halo/shared";

export function loadKeypairFromEnv(name: string): Keypair {
  const value = requireEnv(name).trim();

  if (value.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(value) as number[]));
  }

  return Keypair.fromSecretKey(bs58.decode(value));
}
