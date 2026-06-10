import { createRequire } from "node:module";
import type { Keypair } from "@solana/web3.js";

const require = createRequire(import.meta.url);

const jitoSdk = require("jito-ts/dist/sdk/block-engine/index.js") as {
  bundle: {
    Bundle: new (
      txs: import("@solana/web3.js").VersionedTransaction[],
      transactionLimit: number,
    ) => JitoBundle;
  };
  searcher: {
    searcherClient: (url: string, authKeypair?: Keypair) => SearcherClient;
  };
};

export interface JitoBundle {
  addTransactions(
    ...transactions: import("@solana/web3.js").VersionedTransaction[]
  ): JitoBundle | Error;
  addTipTx(
    keypair: Keypair,
    tipLamports: number,
    tipAccount: import("@solana/web3.js").PublicKey,
    recentBlockhash: string,
  ): JitoBundle | Error;
}

export interface SearcherClient {
  getTipAccounts(): Promise<Result<string[]>>;
  getNextScheduledLeader(): Promise<
    Result<{
      currentSlot: number;
      nextLeaderSlot: number;
      nextLeaderIdentity: string;
    }>
  >;
  sendBundle(bundle: JitoBundle): Promise<Result<string>>;
}

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

export const Bundle = jitoSdk.bundle.Bundle;
export const searcherClient = jitoSdk.searcher.searcherClient;

export function isBundleError<T>(value: T | Error): value is Error {
  return value instanceof Error;
}

export function unwrapBundle(value: JitoBundle | Error): JitoBundle {
  if (isBundleError(value)) {
    throw value;
  }

  return value;
}
