const { createClient } = require("./client");
const { MAP_NAME, NUM_ENTRIES } = require("./constants");

(async () => {
  const client = await createClient();
  const map = await client.getMap(MAP_NAME);

  console.log(
    `Writing ${NUM_ENTRIES} entries to Distributed Map '${MAP_NAME}'...`,
  );
  const start = Date.now();

  for (let i = 0; i < NUM_ENTRIES; i++) {
    await map.put(String(i), `value-${i}`);
    if ((i + 1) % 2000 === 0) {
      console.log(`  Written ${i + 1} entries...`);
    }
  }

  const elapsed = Date.now() - start;
  console.log(`Done! Wrote ${NUM_ENTRIES} entries in ${elapsed} ms`);
  console.log(`Map size: ${await map.size()}`);
  console.log("\nNext: View map in Management Center, test node disconnection");
  await client.shutdown();
})();
