const express = require("express");
const axios = require("axios");
const { Client } = require("hazelcast-client");

const USER_TX_MULTIMAP =
  process.env.USER_TX_MULTIMAP || "lab4-user-transactions";
const HZ_MEMBERS = (
  process.env.HZ_MEMBERS || "hz1:5701,hz2:5701,hz3:5701"
).split(",");
const CLUSTER_NAME = process.env.HZ_CLUSTER_NAME || "dev";

const INSTANCE_LABEL =
  process.env.INSTANCE_LABEL || process.env.HOSTNAME || "logging";

const CONFIG_SERVER_URL =
  process.env.CONFIG_SERVER_URL || "http://localhost:4000";
const REGISTER_URL = process.env.PUBLIC_BASE_URL;

let hzClient;
let userTxMap;

async function initHz() {
  hzClient = await Client.newHazelcastClient({
    clusterName: CLUSTER_NAME,
    network: { clusterMembers: HZ_MEMBERS },
  });
  userTxMap = await hzClient.getMultiMap(USER_TX_MULTIMAP);
}

async function register() {
  if (!REGISTER_URL) {
    console.warn("[logging] PUBLIC_BASE_URL not set, skipping config registration");
    return;
  }
  for (let i = 0; i < 30; i++) {
    try {
      await axios.post(`${CONFIG_SERVER_URL}/register`, {
        serviceName: "logging-service",
        baseUrl: REGISTER_URL,
      });
      console.log(`[logging ${INSTANCE_LABEL}] registered at ${REGISTER_URL}`);
      return;
    } catch (e) {
      console.log(`[logging ${INSTANCE_LABEL}] register retry ${i + 1}/30...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("config-server registration failed");
}

const app = express();
app.use(express.json());

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

const PORT = process.env.PORT || 3001;

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
