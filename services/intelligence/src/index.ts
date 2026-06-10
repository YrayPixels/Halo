import { optionalEnv } from "@halo/shared";

async function main(): Promise<void> {
  const redisUrl = optionalEnv("REDIS_URL", "redis://localhost:6379");

  console.log("HALO intelligence starting");
  console.log(`Redis: ${redisUrl}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
