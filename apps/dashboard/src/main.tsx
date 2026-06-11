import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SolanaWalletProvider } from "./components/SolanaWalletProvider.js";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SolanaWalletProvider>
      <App />
    </SolanaWalletProvider>
  </React.StrictMode>,
);
