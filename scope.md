Good. The biggest risk with a project like HALO is trying to build everything at once.

Don't start with AI.
Don't start with dashboards.
Don't start with agents.

Start by proving you can **observe the network and successfully execute + track a bundle**.

---

# Phase 1 — Build the Foundation

Goal:

```txt
Watch Solana
Submit Bundle
Track Lifecycle
```

If you can do this, you've already completed about 60% of the bounty.

---

# Step 1: Create the Monorepo

```txt
halo/
│
├── apps/
│   └── dashboard/
│
├── services/
│   ├── watcher/
│   ├── executor/
│   ├── tracker/
│   └── intelligence/
│
├── packages/
│   ├── database/
│   ├── shared/
│   └── types/
│
├── docker-compose.yml
│
└── package.json
```

Use:

```txt
Turborepo
pnpm
TypeScript
```

---

# Step 2: Infrastructure

Run locally:

```yaml
Postgres
Redis
```

Docker compose:

```yaml
version: "3"

services:
  postgres:
    image: postgres:16
    ports:
      - "5432:5432"

  redis:
    image: redis:7
    ports:
      - "6379:6379"
```

---

# Step 3: Build the Watcher Service

This is the most important first service.

Purpose:

```txt
Listen to Solana in real time
```

Input:

```txt
Yellowstone Stream
```

Output:

```txt
Redis
```

---

Watcher receives:

```txt
Slots
Blocks
Transactions
```

Stores:

```txt
Current Slot
Current Leader
Recent Transactions
Network Metrics
```

into Redis.

---

Example:

```ts
Current Slot

redis.set(
  "network:current_slot",
  slot
)
```

---

# What We Want To See

Terminal:

```txt
Slot: 302910001
Slot: 302910002
Slot: 302910003
Slot: 302910004
```

If this works:

✅ Yellowstone connected

✅ Realtime data flowing

---

# Step 4: Build Lifecycle Database

Use Prisma.

---

Schema:

```prisma
model Transaction {
  id            String   @id @default(uuid())

  signature     String?

  bundleId      String?

  status        String

  createdAt     DateTime @default(now())

  processedAt   DateTime?

  confirmedAt   DateTime?

  finalizedAt   DateTime?

  slot          BigInt?

  tipLamports   BigInt?
}
```

---

Run:

```bash
pnpm prisma migrate dev
```

---

# Step 5: Build Executor

Purpose:

```txt
Build transaction
Build bundle
Submit bundle
```

For MVP:

Use a simple transfer.

Example:

```ts
walletA
   ↓
walletB
```

Don't start with swaps.

Don't start with DeFi.

Just send SOL.

---

Flow:

```txt
Create Transaction
       ↓
Sign
       ↓
Create Bundle
       ↓
Submit
```

---

Success Criteria:

Get a real bundle ID.

```txt
Bundle:
8xyf9...
```

---

# Step 6: Build Tracker

This satisfies a huge bounty requirement.

Purpose:

```txt
Track lifecycle
```

---

States:

```txt
SUBMITTED
PROCESSED
CONFIRMED
FINALIZED
```

---

When bundle submitted:

```sql
status = SUBMITTED
```

When stream sees transaction:

```sql
status = PROCESSED
```

Then:

```sql
CONFIRMED
```

Then:

```sql
FINALIZED
```

---

Store timestamps.

Example:

```json
{
  "signature": "...",
  "submitted_at": "...",
  "processed_at": "...",
  "confirmed_at": "...",
  "finalized_at": "..."
}
```

---

# Milestone 1

At this point you'll have:

```txt
Yellowstone Stream
Bundle Submission
Lifecycle Tracking
Database
```

Which already demonstrates:

✅ Live streaming

✅ Jito integration

✅ Commitment tracking

✅ Real transactions

---

# Phase 2

After Milestone 1:

Build:

```txt
Leader Intelligence
```

New service:

```txt
services/intelligence
```

Tracks:

```txt
Current Leader
Next Leader
Jito Leaders
```

Outputs:

```json
{
  "recommendedSubmitSlot": 302912200
}
```

Store in Redis.

---

# Phase 3

Now add:

```txt
Tip Intelligence
```

Read:

```txt
Recent tip accounts
```

Generate:

```json
{
  "recommendedTip": 9000
}
```

Store in Redis.

---

# Phase 4

Now add the AI.

The simplest bounty-winning agent is:

### Failure Reasoning Agent

Input:

```json
{
  "failure": "blockhash_expired",
  "leader_distance": 12,
  "tip": 3000
}
```

Prompt:

```txt
Analyze why this bundle failed.
Recommend next action.
```

Output:

```json
{
  "reason": "Blockhash expired before reaching leader",
  "action": "refresh_blockhash",
  "new_tip": 8000
}
```

Store decision.

Retry automatically.

This alone satisfies the AI requirement if implemented correctly.

---

# First Week Build Plan

### Day 1

```txt
Monorepo
Docker
Postgres
Redis
```

### Day 2

```txt
Yellowstone connection
Slot streaming
```

### Day 3

```txt
Lifecycle database
```

### Day 4

```txt
Jito bundle submission
```

### Day 5

```txt
Transaction tracking
```

### Day 6

```txt
Dashboard
```

### Day 7

```txt
Failure classification
```

By the end of that week, you'll have the core infrastructure running and can start layering in leader intelligence, dynamic tips, and AI reasoning instead of trying to tackle everything upfront.
