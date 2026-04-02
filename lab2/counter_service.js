const { createClient } = require("./client");
const {
  COUNTER_MAP,
  COUNTER_KEY,
  LOCK_NAME,
  ITERATION_NAME,
  TARGET,
  SLEEP_MS,
  CP_WARMUP_MS,
} = require("./constants");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(val) {
  if (val == null) return 0;
  return typeof val === "object" && val.toNumber ? val.toNumber() : Number(val);
}

(async () => {
  const serviceId = process.argv[2] || "1";
  console.log(
    `[service-${serviceId}] Starting Counter Service (CP Subsystem FencedLock + AtomicLong)...`,
  );

  const client = await createClient();
  console.log(`[service-${serviceId}] Connected to Hazelcast`);

  const sid = parseInt(serviceId, 10) || 1;
  const staggerMs = (sid - 1) * 2000;
  if (staggerMs > 0) {
    console.log(`[service-${serviceId}] Stagger ${staggerMs}ms before CP...`);
    await sleep(staggerMs);
  }
  console.log(
    `[service-${serviceId}] CP warmup ${CP_WARMUP_MS}ms (Raft must be ready before FencedLock)...`,
  );
  await sleep(CP_WARMUP_MS);

  const cpSubsystem = client.getCPSubsystem();
  let lock;
  let iteration;
  const counterMap = await client.getMap(COUNTER_MAP);
  await counterMap.putIfAbsent(COUNTER_KEY, 0);

  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      lock = await cpSubsystem.getLock(LOCK_NAME);
      iteration = await cpSubsystem.getAtomicLong(ITERATION_NAME);
      await iteration.get();
      console.log(
        `[service-${serviceId}] CP Subsystem ready (attempt ${attempt})`,
      );
      break;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.warn(
        `[service-${serviceId}] CP not ready (${attempt}/${maxAttempts}): ${msg.slice(0, 120)}...`,
      );
      if (attempt === maxAttempts) throw e;
      await sleep(3000);
    }
  }

  let fenceHeld = null;
  const unlockHeld = async () => {
    if (fenceHeld == null) return;
    try {
      await lock.unlock(fenceHeld);
    } catch (_) {
      /* ignore */
    }
    fenceHeld = null;
  };
  process.once("SIGINT", async () => {
    console.log(
      `\n[service-${serviceId}] SIGINT — releasing lock and closing client...`,
    );
    await unlockHeld();
    try {
      await client.shutdown();
    } catch (_) {
      /* ignore */
    }
    process.exit(0);
  });

  try {
    while (true) {
      console.log(`[service-${serviceId}] Waiting for CP FencedLock...`);
      const fence = await lock.lock();
      fenceHeld = fence;
      console.log(`[service-${serviceId}] Lock acquired (fence: ${fence})`);
      try {
        const iter = toNumber(await iteration.get()); // Task point 6: continue from AtomicLong
        if (iter >= TARGET) {
          const finalCount = await counterMap.get(COUNTER_KEY);
          console.log(
            `[service-${serviceId}] Target reached! Final counter = ${finalCount}`,
          );
          break;
        }

        const newCount = iter + 1;
        await counterMap.put(COUNTER_KEY, newCount);
        await iteration.set(newCount); // Task point 5: store iteration in AtomicLong

        if (newCount % 10_000 === 0) {
          console.log(`[service-${serviceId}] Counter = ${newCount}`);
        }

        if (newCount >= TARGET) {
          console.log(
            `[service-${serviceId}] DONE! Final counter = ${newCount}`,
          );
          break;
        }

        await sleep(SLEEP_MS);
      } finally {
        await unlockHeld();
      }
    }
  } finally {
    await client.shutdown();
  }
})();
