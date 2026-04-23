const express = require("express");
const axios = require("axios");
const { Client } = require("hazelcast-client");

const CONSUL_HTTP_ADDR = process.env.CONSUL_HTTP_ADDR || "http://consul:8500";
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 5000);
const PORT = Number(process.env.PORT || 3001);
const SERVICE_NAME = process.env.SERVICE_NAME || "logging-service";
const INSTANCE_LABEL = process.env.INSTANCE_LABEL || process.env.HOSTNAME || "logging";
const SERVICE_ID =
  process.env.SERVICE_ID || `${SERVICE_NAME}-${process.env.HOSTNAME || PORT}`;
const SERVICE_ADDRESS = process.env.SERVICE_ADDRESS || process.env.HOSTNAME;

let hzClient;
let userTxMap;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function initHz() {
  const userTxMultimap = await readKv(
    "config/hazelcast/multimap/user-transactions",
    "lab5-user-transactions",
  );
  const hzMembersRaw = await readKv(
    "config/hazelcast/members",
    "hz1:5701,hz2:5701,hz3:5701",
  );
  const clusterName = await readKv("config/hazelcast/cluster-name", "dev");
  const hzMembers = hzMembersRaw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  hzClient = await Client.newHazelcastClient({
    clusterName,
    network: { clusterMembers: hzMembers },
  });
  userTxMap = await hzClient.getMultiMap(userTxMultimap);
  console.log(
    `[logging ${INSTANCE_LABEL}] Hazelcast connected, map=${userTxMultimap}, members=${hzMembers.join(",")}`,
  );
}

async function register() {
  if (!SERVICE_ADDRESS) {
    console.warn("[logging] SERVICE_ADDRESS is empty, skipping Consul registration");
    return;
  }
  const payload = {
    ID: SERVICE_ID,
    Name: SERVICE_NAME,
    Address: SERVICE_ADDRESS,
    Port: PORT,
    Check: {
      HTTP: `http://${SERVICE_ADDRESS}:${PORT}/health`,
      Interval: "10s",
      Timeout: "3s",
      DeregisterCriticalServiceAfter: "1m",
    },
  };
  for (let i = 0; i < 30; i++) {
    try {
      await axios.put(`${CONSUL_HTTP_ADDR}/v1/agent/service/register`, payload, {
        timeout: HTTP_TIMEOUT_MS,
      });
      console.log(`[logging ${INSTANCE_LABEL}] registered in Consul as ${SERVICE_ID}`);
      return;
    } catch (e) {
      console.log(`[logging ${INSTANCE_LABEL}] register retry ${i + 1}/30...`);
      await sleep(2000);
    }
  }
  throw new Error("Consul registration failed");
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: SERVICE_NAME, id: SERVICE_ID });
});

app.post("/log", async (req, res) => {
  try {
    const message = req.body;
    const { transaction_ID, user_Id } = message;

    if (!transaction_ID) {
      return res.status(400).json({ error: "transaction_ID is required" });
    }

    const key = String(user_Id);
    const payload = JSON.stringify(message);
    await userTxMap.put(key, payload);

    console.log(
      `[logging ${INSTANCE_LABEL}] accepted tx ${transaction_ID} user=${key} (stored in Hazelcast MultiMap)`,
    );

    res.json({ status: "ok", transaction_ID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function multimapValuesToArray(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw[Symbol.iterator] === "function") return [...raw];
  return [raw];
}

app.get("/transactions/:user_Id", async (req, res) => {
  try {
    const { user_Id } = req.params;
    const key = String(user_Id);
    const raw = await userTxMap.get(key);
    const items = multimapValuesToArray(raw);
    const transactions = items.map((s) =>
      typeof s === "string" ? JSON.parse(s) : s,
    );
    res.json({ transactions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

async function main() {
  await initHz();
  await register();
  app.listen(PORT, () => {
    console.log(`[logging ${INSTANCE_LABEL}] HTTP on ${PORT}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
