# HALO Architecture

HALO is a Solana network observer and Jito bundle execution tracker. It watches live network state, submits bundles, tracks their lifecycle, and runs an agent pipeline when bundles fail or stall.

## System Overview

```mermaid
flowchart TB
  Browser[Browser<br/>localhost:5173]

  subgraph Apps
    Dashboard["@halo/dashboard<br/>Express API + Vite React UI"]
  end

  subgraph Services
    Watcher["@halo/watcher<br/>Yellowstone slot stream"]
    Tracker["@halo/tracker<br/>Transaction lifecycle tracker"]
    Intelligence["@halo/intelligence<br/>Failure analysis + retry decisions"]
    Executor["@halo/executor<br/>Jito bundle submitter"]
  end

  subgraph Packages
    Shared["@halo/shared<br/>Redis keys, streams, env, Yellowstone client"]
    Database["@halo/database<br/>Prisma client + lifecycle helpers"]
    Types["@halo/types<br/>Shared domain types"]
  end

  subgraph Infra
    Redis[(Redis 7<br/>network cache + streams)]
    Postgres[(Postgres 16<br/>transaction + agent history)]
  end

  subgraph External
    Yellowstone[Yellowstone gRPC]
    SolanaRPC[Solana RPC]
    Jito[Jito Block Engine]
    OpenAI[OpenAI API<br/>optional]
  end

  Browser --> Dashboard
  Dashboard --> Redis
  Dashboard --> Postgres

  Yellowstone -->|slots + block metadata| Watcher
  Watcher -->|network:* keys| Redis

  Executor -->|get blockhash + simulate| SolanaRPC
  Executor -->|send bundle| Jito
  Executor -->|SUBMITTED / FAILED rows| Postgres
  Executor -->|lifecycle queue + telemetry| Redis

  Tracker -->|poll signature statuses| SolanaRPC
  Tracker -->|read lifecycle queue| Redis
  Tracker -->|publish + consume halo:tx_events| Redis
  Tracker -->|advance lifecycle rows| Postgres

  Intelligence -->|read failures + write decisions| Postgres
  Intelligence -->|read network state + publish agent/retry streams| Redis
  Intelligence -->|leader, fee, simulation context| SolanaRPC
  Intelligence -->|leader and tip context| Jito
  Intelligence -.->|decision synthesis when configured| OpenAI

  Watcher --> Shared
  Tracker --> Shared
  Intelligence --> Shared
  Executor --> Shared
  Dashboard --> Shared

  Tracker --> Database
  Intelligence --> Database
  Executor --> Database
  Dashboard --> Database

  Shared --> Types
  Database --> Types

  Redis -->|halo:retry_requests| Executor
```

## Component Responsibilities

| Component | Path | Responsibility |
| --- | --- | --- |
| Dashboard | `apps/dashboard` | Serves the React UI and API endpoints. Reads live Redis state, transaction rows, and agent history for the dashboard. |
| Watcher | `services/watcher` | Owns the Yellowstone gRPC connection and writes live slot/block metadata into Redis. |
| Tracker | `services/tracker` | Tracks submitted signatures through Solana commitments and writes lifecycle transitions to Postgres. |
| Intelligence | `services/intelligence` | Detects failed/stalled bundles, runs failure/tip/timing agents, records decisions, and publishes retry requests. |
| Executor | `services/executor` | Builds and submits Jito bundles. In daemon mode, consumes retry requests and resubmits child attempts. |
| Shared | `packages/shared` | Defines Redis keys, streams, consumer groups, queue helpers, env helpers, and shared service adapters. |
| Database | `packages/database` | Owns the Prisma schema, generated client, and lifecycle persistence helpers. |
| Types | `packages/types` | Defines shared transaction, network, failure, retry, and agent types. |

## Happy Path

```mermaid
sequenceDiagram
  participant U as User / Operator
  participant E as Executor
  participant J as Jito Block Engine
  participant RPC as Solana RPC
  participant R as Redis
  participant T as Tracker
  participant PG as Postgres
  participant D as Dashboard

  U->>E: Run pnpm dev:executor
  E->>RPC: Fetch fresh blockhash and simulate
  E->>J: Submit bundle
  E->>PG: Create SUBMITTED transaction row
  E->>R: Add signature to halo:lifecycle_queue
  T->>R: Read active signatures
  T->>RPC: Poll getSignatureStatuses
  T->>R: Publish lifecycle event to halo:tx_events
  T->>R: Consume halo:tx_events
  T->>PG: Advance SUBMITTED -> PROCESSED -> CONFIRMED -> FINALIZED
  D->>R: Read network state
  D->>PG: Read recent transactions
```

The normal transaction status path is:

```mermaid
stateDiagram-v2
  [*] --> SUBMITTED
  SUBMITTED --> PROCESSED
  PROCESSED --> CONFIRMED
  CONFIRMED --> FINALIZED
  SUBMITTED --> FAILED
  PROCESSED --> FAILED
  CONFIRMED --> FAILED
```

## Failure And Retry Path

```mermaid
sequenceDiagram
  participant E as Executor
  participant T as Tracker
  participant PG as Postgres
  participant I as Intelligence
  participant R as Redis
  participant J as Jito Block Engine
  participant OAI as OpenAI optional

  E->>PG: Record immediate simulation/send failure
  T->>PG: Record RPC-observed failure
  I->>PG: Load unprocessed failures and stale submissions
  I->>R: Read network slot, leader, tip, and fee context
  I->>I: Failure Agent classifies root cause
  I->>I: Tip Agent recommends tip adjustment
  I->>I: Timing Agent checks leader window
  I-.->>OAI: Optional synthesis
  I->>PG: Persist AgentDecision, AgentStep, AgentComm
  I->>R: Publish halo:agent_comms
  alt Retry recommended
    I->>R: Publish halo:retry_requests
    E->>R: Executor daemon consumes retry request
    E->>J: Submit retry bundle
    E->>PG: Create child transaction attempt
  else Abort recommended
    I->>PG: Mark decision as processed without retry
  end
```

## Redis Contract

| Key or Stream | Type | Writer | Reader | Purpose |
| --- | --- | --- | --- | --- |
| `network:current_slot` | Key | Watcher | Dashboard, Intelligence | Latest observed Solana slot. |
| `network:slot_meta` | Key | Watcher | Dashboard, Intelligence | Latest block metadata snapshot. |
| `network:current_leader` | Key | Intelligence | Dashboard, Intelligence | Current or inferred slot leader. |
| `network:next_jito_leader_*` | Keys | Executor, Intelligence | Dashboard, Intelligence, Executor | Next Jito leader timing context. |
| `network:recommended_submit_slot` | Key | Executor, Intelligence | Dashboard, Executor | Suggested submission slot. |
| `network:recommended_tip` | Key | Intelligence | Dashboard, Executor | Agent-recommended Jito tip. |
| `network:median_priority_fee` | Key | Executor, Intelligence | Dashboard, Intelligence | Fee telemetry used by tip decisions. |
| `halo:lifecycle_queue` | Hash | Executor, Dashboard wallet test | Tracker | Active signatures waiting for lifecycle resolution. |
| `halo:tx_events` | Stream | Tracker | Tracker | Lifecycle promotion events persisted into Postgres. |
| `halo:agent_comms` | Stream | Intelligence | Dashboard | Agent messages for the swarm and reasoning views. |
| `halo:retry_requests` | Stream | Intelligence | Executor daemon | Retry commands for failed or stalled bundles. |

## Persistent Data

```mermaid
erDiagram
  Transaction ||--o{ Transaction : "parentTransactionId retry chain"
  Transaction ||--o{ AgentDecision : "failure analysis"
  AgentDecision ||--o{ AgentStep : "agent reasoning"
  AgentDecision ||--o{ AgentComm : "agent messages"

  Transaction {
    string id
    string signature
    string status
    int submittedSlot
    int processedSlot
    int confirmedSlot
    int finalizedSlot
    string failureClass
    string parentTransactionId
  }

  AgentDecision {
    string id
    string transactionId
    string action
    bool shouldRetry
    int attemptNumber
    bool processed
  }

  AgentStep {
    string id
    string decisionId
    string agentName
    string summary
    string tone
  }

  AgentComm {
    string id
    string decisionId
    string fromAgent
    string toAgent
    string message
  }
```

Postgres is the durable audit log for bundle attempts and agent decisions. Redis is the live coordination layer for network state, lifecycle queues, agent messages, and retry requests.

## Local Runtime

```mermaid
flowchart LR
  DevAll["pnpm dev:all"] --> Infra["docker compose<br/>Postgres + Redis"]
  DevAll --> Migrate["pnpm db:migrate"]
  DevAll --> Watcher
  DevAll --> Tracker
  DevAll --> Intelligence
  DevAll --> Dashboard

  ExecutorOneShot["pnpm dev:executor"] --> ExecutorSubmit["Submit one live Jito bundle"]
  ExecutorDaemon["pnpm dev:executor:daemon"] --> ExecutorRetry["Listen for halo:retry_requests"]
```

`pnpm dev:all` intentionally does not start the executor because the executor can submit real Jito bundles and spend SOL. Run `pnpm dev:executor` or `pnpm dev:executor:daemon` only when the wallet and environment are ready.

## End-To-End Flow

1. Watcher streams live Solana slot data from Yellowstone into Redis.
2. Executor submits a Jito bundle, writes a `SUBMITTED` transaction row, and puts its signature in the Redis lifecycle queue.
3. Tracker polls Solana RPC for active signatures, emits lifecycle events, and persists status changes to Postgres.
4. Dashboard reads Redis and Postgres to show network health, recent transactions, and agent activity.
5. Intelligence looks for failures and stale submissions, classifies the cause, computes tip and timing changes, and records the agent reasoning.
6. If retry is recommended, Intelligence publishes a retry request and the executor daemon submits a new child attempt.
