const { Client } = require("hazelcast-client");
const { openDbReadWrite, applyTransaction, DB_PATH } = require("./store");

const COUNTER_QUEUE = process.env.COUNTER_QUEUE || "lab4-counter-queue";
const HZ_MEMBERS = (
  process.env.HZ_MEMBERS || "hz1:5701,hz2:5701,hz3:5701"
).split(",");
const CLUSTER_NAME = process.env.HZ_CLUSTER_NAME || "dev";

let hzClient;
let queue;
const db = openDbReadWrite();

function parseQueuePayload(item) {
  if (item == null) return null;
  const raw =
    typeof item === "string"
      ? item
      : Buffer.isBuffer(item)
        ? item.toString("utf8")
        : String(item);
  return JSON.parse(raw);
}

async function consumeLoop() {
  console.log("[counter-worker] queue consumer started, DB", DB_PATH);
  for (;;) {
    try {
      const item = await queue.take();
      if (item == null) continue;
      const msg = parseQueuePayload(item);
      applyTransaction(db, msg);
      console.log(
        `[counter-worker] applied tx ${msg.transaction_ID} user=${msg.user_Id} amount=${msg.amount}`,
      );
    } catch (e) {
      console.error(
        "[counter-worker] consume error:",
        e?.stack || e?.message || String(e),
      );
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function main() {
  hzClient = await Client.newHazelcastClient({
    clusterName: CLUSTER_NAME,
    network: { clusterMembers: HZ_MEMBERS },
  });
  queue = await hzClient.getQueue(COUNTER_QUEUE);
  consumeLoop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
