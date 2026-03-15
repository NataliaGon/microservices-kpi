/**
 * Part II - Distributed Lock Counter Service
 * Run 3 instances: node counter_service.js 1, node counter_service.js 2, node counter_service.js 3
 *
 * Uses Map lock (releases on client disconnect) + iteration in Map for failover
 * Final counter = 100,000
 */

const { createClient } = require('./client');
const {
  COUNTER_MAP,
  COUNTER_KEY,
  LOCK_NAME,
  ITERATION_NAME,
  TARGET,
  SLEEP_MS,
} = require('./constants');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const serviceId = process.argv[2] || '1';
  console.log(`[service-${serviceId}] Starting Counter Service...`);

  const client = await createClient();
  console.log(`[service-${serviceId}] Connected to Hazelcast`);

  const counterMap = await client.getMap(COUNTER_MAP);
  await counterMap.putIfAbsent(COUNTER_KEY, 0);
  await counterMap.putIfAbsent(ITERATION_NAME, 0);

  try {
    while (true) {
      console.log(`[service-${serviceId}] Waiting for lock...`);
      await counterMap.lock(LOCK_NAME);
      console.log(`[service-${serviceId}] Lock acquired`);
      try {
        const currentIter = (await counterMap.get(ITERATION_NAME)) || 0;
        const iter = typeof currentIter === 'object' && currentIter.toNumber ? currentIter.toNumber() : Number(currentIter);
        if (iter >= TARGET) {
          const finalCount = await counterMap.get(COUNTER_KEY);
          console.log(`[service-${serviceId}] Target reached! Final counter = ${finalCount}`);
          break;
        }

        const newCount = iter + 1;
        await counterMap.put(COUNTER_KEY, newCount);
        await counterMap.put(ITERATION_NAME, newCount);

        if (newCount % 10_000 === 0) {
          console.log(`[service-${serviceId}] Counter = ${newCount}`);
        }

        if (newCount >= TARGET) {
          console.log(`[service-${serviceId}] DONE! Final counter = ${newCount}`);
          break;
        }

        await sleep(SLEEP_MS);
      } finally {
        await counterMap.unlock(LOCK_NAME);
      }
    }
  } finally {
    await client.shutdown();
  }
})();
