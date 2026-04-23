const axios = require("axios");
const { Client } = require("hazelcast-client");
const { openDbReadWrite, applyTransaction, DB_PATH } = require("./store");

const CONSUL_HTTP_ADDR = process.env.CONSUL_HTTP_ADDR || "http://consul:8500";
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 5000);

let hzClient;
let queue;
const db = openDbReadWrite();

async function readKv(key, fallback) {
  try {
    const encoded = key
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const { data } = await axios.get(`${CONSUL_HTTP_ADDR}/v1/kv/${encoded}?raw`, {
      timeout: HTTP_TIMEOUT_MS,
      responseType: "text",
    });
    const value = String(data || "").trim();
    return value.length ? value : fallback;
  } catch {
    return fallback;
  }
}

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
  const hzMembersRaw = await readKv(
    "config/hazelcast/members",
    "hz1:5701,hz2:5701,hz3:5701",
  );
  const clusterName = await readKv("config/hazelcast/cluster-name", "dev");
  const counterQueueName = await readKv(
    "config/mq/queue/name",
    "lab5-counter-queue",
  );
  const hzMembers = hzMembersRaw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  hzClient = await Client.newHazelcastClient({
    clusterName,
    network: { clusterMembers: hzMembers },
  });
  queue = await hzClient.getQueue(counterQueueName);
  console.log(
    `[counter-worker] connected, queue=${counterQueueName}, members=${hzMembers.join(",")}`,
  );
  consumeLoop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
