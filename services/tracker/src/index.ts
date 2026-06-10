import { optionalEnv } from "@halo/shared";
import type { TransactionStatus } from "@halo/types";

const lifecycle: TransactionStatus[] = ["SUBMITTED", "PROCESSED", "CONFIRMED", "FINALIZED"];

async function main(): Promise<void> {
  const databaseUrl = optionalEnv("DATABASE_URL", "postgresql://halo:halo@localhost:5432/halo");

  console.log("HALO tracker starting");
  console.log(`Database: ${databaseUrl}`);
  console.log(`Lifecycle states: ${lifecycle.join(" -> ")}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
