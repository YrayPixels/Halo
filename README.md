# HALO

HALO is a Solana network observer and Jito bundle execution tracker. The core goal is to watch the chain in real time, submit bundles, and record enough lifecycle data to understand why a transaction landed, lagged, or failed.

## README Questions

### Question 1: What does the delta between `processed_at` and `confirmed_at` tell you about network health at the time of submission?

The delta between `processed_at` and `confirmed_at` is a practical latency signal for how quickly the cluster moved a landed transaction from optimistic observation to broader vote confirmation.

In HALO, `processed_at` means the transaction was first observed in a processed slot from the live stream. `confirmed_at` means the transaction later reached confirmed commitment. A small delta means the cluster was voting and propagating normally: the leader produced the block, validators saw it quickly, and the transaction moved through commitment without much delay.

A growing delta is a warning sign. It can point to congestion, slow propagation, skipped slots near the submission window, heavy leader load, or the transaction landing on a fork that took longer to become the voted fork. If `processed_at` exists but `confirmed_at` never arrives, the transaction may have been observed on a fork that did not confirm, may have been dropped by the cluster, or may have expired before a durable confirmed result was reached.

For operations, this delta tells us whether failures are likely local or network-related. If many transactions show the same widened processed-to-confirmed gap, the network was unhealthy or congested during that window. If only one bundle shows the gap while surrounding traffic confirms quickly, the issue is more likely transaction-specific: tip too low, bad timing relative to the leader, account contention, or blockhash expiry.

### Question 2: Why should you never use `finalized` commitment when fetching a blockhash for a time-sensitive transaction?

A blockhash is a timer. Solana transactions are only valid while their recent blockhash remains inside the cluster's recent blockhash window. For a time-sensitive transaction or Jito bundle, every slot of freshness matters.

Fetching a blockhash at `finalized` commitment gives you an older blockhash because finalization waits for substantially more cluster agreement than `processed` or `confirmed`. That extra safety comes at the cost of latency and remaining lifetime. By the time the transaction is signed, routed, auctioned, and reaches the target leader, a finalized blockhash can already be much closer to expiry.

The result is avoidable failure: `BlockhashNotFound`, expired blockhash, or a bundle that reaches the right leader too late to be executed. For time-sensitive execution, fetch a fresh blockhash at `processed` or `confirmed` commitment, track `lastValidBlockHeight`, and refresh the blockhash before resubmitting if the leader window moves.

### Question 3: What happens to your bundle if the Jito leader skips their slot?

A Jito bundle only lands if a Jito leader actually produces a block for the slot where the bundle is eligible. If that leader skips the slot, there is no block for the bundle to be included in.

The bundle does not partially execute, the Jito tip is not paid, and the bundle should be treated as not landed. It also should not be assumed to automatically land with the next non-Jito leader. The correct response is to detect the skipped slot, check whether the blockhash is still valid, refresh it if needed, recalculate the next Jito leader window, and resubmit the bundle.

Operationally, a skipped Jito leader looks different from a bad transaction. A bad transaction usually produces simulation or execution errors. A skipped leader produces absence: no inclusion, no signature status transition, and no tip payment. HALO should classify that as a timing or leader-availability failure, not as proof that the transaction logic was invalid.
