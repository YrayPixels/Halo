import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const jitoSdk = require("jito-ts/dist/sdk/block-engine/index.js") as {
  searcher: {
    searcherClient: (url: string) => SearcherClient;
  };
};

export interface SearcherClient {
  getNextScheduledLeader(): Promise<
    | { ok: true; value: { currentSlot: number; nextLeaderSlot: number; nextLeaderIdentity: string } }
    | { ok: false; error: Error }
  >;
}

export const searcherClient = jitoSdk.searcher.searcherClient;
