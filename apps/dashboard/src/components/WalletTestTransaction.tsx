import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type SendOptions,
} from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useEffect, useMemo, useState } from "react";

type WalletTestConfig = {
  rpcUrl: string;
  destination: string;
  lamports: number;
};

function lamportsToSol(lamports: number): string {
  return (lamports / 1_000_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 9,
  });
}

function short(value: string | null): string {
  if (!value) {
    return "not connected";
  }

  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

async function loadConfig(): Promise<WalletTestConfig> {
  const response = await fetch("/api/wallet-test/config");
  if (!response.ok) {
    throw new Error("Failed to load wallet test config");
  }

  return (await response.json()) as WalletTestConfig;
}

async function registerSignature(options: {
  signature: string;
  wallet: string;
  destination: string;
  lamports: number;
}): Promise<void> {
  const response = await fetch("/api/wallet-test/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Failed to register transaction with HALO");
  }
}

async function createFailureDemo(): Promise<{ transactionId: string; bundleId: string }> {
  const response = await fetch("/api/wallet-test/failure-demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Failed to create demo failure");
  }

  return (await response.json()) as { transactionId: string; bundleId: string };
}

export function WalletTestTransaction() {
  const { connected, publicKey, signTransaction } = useWallet();
  const [config, setConfig] = useState<WalletTestConfig | null>(null);
  const [status, setStatus] = useState("Load the wallet config, then connect your browser wallet.");
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failureDemoBusy, setFailureDemoBusy] = useState(false);

  const walletAddress = publicKey?.toBase58() ?? null;
  const canSubmit = Boolean(config?.destination && config.lamports > 0 && connected && publicKey && signTransaction);
  const clusterLabel = useMemo(() => {
    if (!config?.rpcUrl) {
      return "cluster unknown";
    }

    if (config.rpcUrl.includes("devnet")) {
      return "devnet";
    }

    if (config.rpcUrl.includes("testnet")) {
      return "testnet";
    }

    return "mainnet-beta";
  }, [config?.rpcUrl]);

  useEffect(() => {
    void loadConfig()
      .then((nextConfig) => {
        setConfig(nextConfig);
        setStatus(
          nextConfig.destination
            ? "Ready. Connect your wallet to simulate and send a test transaction."
            : "Set WALLET_TEST_DESTINATION or TRANSFER_DESTINATION before sending.",
        );
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "Failed to load wallet config");
      });
  }, []);

  const sendTestTransaction = async () => {
    if (!publicKey || !signTransaction || !config || !walletAddress) {
      return;
    }

    setBusy(true);
    setSignature(null);

    try {
      const connection = new Connection(config.rpcUrl, "confirmed");
      const destination = new PublicKey(config.destination);
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: destination,
          lamports: config.lamports,
        }),
      );
      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      transaction.feePayer = publicKey;
      transaction.recentBlockhash = latestBlockhash.blockhash;

      setStatus("Simulating transaction before wallet signature...");
      const simulation = await connection.simulateTransaction(transaction, undefined, false);
      if (simulation.value.err) {
        throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
      }

      setStatus(
        `Simulation passed. Your wallet will ask you to approve ${lamportsToSol(config.lamports)} SOL to ${short(
          config.destination,
        )} on ${clusterLabel}.`,
      );

      const signed = await signTransaction(transaction);
      const rawTransaction = signed.serialize();
      const sendOptions: SendOptions = {
        preflightCommitment: "confirmed",
        skipPreflight: false,
        maxRetries: 3,
      };
      const submittedSignature = await connection.sendRawTransaction(rawTransaction, sendOptions);

      await registerSignature({
        signature: submittedSignature,
        wallet: walletAddress,
        destination: config.destination,
        lamports: config.lamports,
      });

      setSignature(submittedSignature);
      setStatus("Transaction submitted and registered with HALO. Tracker will promote it through the lifecycle.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Wallet transaction failed");
    } finally {
      setBusy(false);
    }
  };

  const triggerFailureDemo = async () => {
    setFailureDemoBusy(true);
    setSignature(null);

    try {
      const demo = await createFailureDemo();
      setStatus(
        `Demo failure ${demo.bundleId} created. Intelligence should classify it and update the agent swarm within a few seconds.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create demo failure");
    } finally {
      setFailureDemoBusy(false);
    }
  };

  return (
    <div className="panel p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Wallet Test Transaction</h3>
          <p className="mono mt-1 text-xs text-muted-foreground/70">
            browser wallet signing · {clusterLabel}
          </p>
        </div>
        <WalletMultiButton />
      </div>

      <div className="space-y-2 rounded-lg border border-border/50 bg-surface-elevated/50 p-3 mono text-xs text-muted-foreground">
        <div className="flex justify-between gap-3">
          <span>amount</span>
          <span className="text-foreground">{config ? `${lamportsToSol(config.lamports)} SOL` : "loading"}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>recipient</span>
          <span className="text-foreground">{short(config?.destination ?? null)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>fee payer</span>
          <span className="text-foreground">{short(walletAddress)}</span>
        </div>
      </div>

      <button
        className="mono mt-4 w-full rounded-lg bg-gradient-solar px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-background transition disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        disabled={!canSubmit || busy || failureDemoBusy}
        onClick={() => void sendTestTransaction()}
      >
        {busy ? "Submitting..." : "Simulate + Send"}
      </button>
      <button
        className="mono mt-3 w-full rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-danger transition hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        disabled={busy || failureDemoBusy}
        onClick={() => void triggerFailureDemo()}
      >
        {failureDemoBusy ? "Creating Failure..." : "Test Failed Transaction"}
      </button>

      <p className="mono mt-3 text-xs leading-relaxed text-muted-foreground">{status}</p>
      {signature && (
        <p className="mono mt-2 break-all text-[10px] text-success">signature {signature}</p>
      )}
    </div>
  );
}
