import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { useEffect, useMemo, useState, type ReactNode } from "react";

type WalletTestConfig = {
  rpcUrl: string;
};

const FALLBACK_RPC_URL = "https://api.mainnet-beta.solana.com";

async function loadWalletConfig(): Promise<WalletTestConfig> {
  const response = await fetch("/api/wallet-test/config");
  if (!response.ok) {
    throw new Error("Failed to load wallet config");
  }

  return (await response.json()) as WalletTestConfig;
}

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const [endpoint, setEndpoint] = useState(FALLBACK_RPC_URL);
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  useEffect(() => {
    void loadWalletConfig()
      .then((config) => {
        if (config.rpcUrl) {
          setEndpoint(config.rpcUrl);
        }
      })
      .catch(() => {
        setEndpoint(FALLBACK_RPC_URL);
      });
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
