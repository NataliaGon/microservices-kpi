const express = require("express");
const axios = require("axios");
const { Client } = require("hazelcast-client");

const CONFIG_SERVER_URL =
  process.env.CONFIG_SERVER_URL || "http://localhost:4000";
const COUNTER_QUEUE = process.env.COUNTER_QUEUE || "lab4-counter-queue";
const HZ_MEMBERS = (
  process.env.HZ_MEMBERS || "hz1:5701,hz2:5701,hz3:5701"
).split(",");
const CLUSTER_NAME = process.env.HZ_CLUSTER_NAME || "dev";

const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 5000);

let hzClient;
let counterQueue;

async function initHz() {
  hzClient = await Client.newHazelcastClient({
    clusterName: CLUSTER_NAME,
    network: { clusterMembers: HZ_MEMBERS },
  });
  counterQueue = await hzClient.getQueue(COUNTER_QUEUE);
}

async function pickServiceUrl(serviceName) {
  const { data } = await axios.get(
    `${CONFIG_SERVER_URL}/services/${serviceName}`,
    { timeout: HTTP_TIMEOUT_MS },
  );
  const { instances } = data;
  if (!instances?.length) {
    throw new Error(`No instances registered for ${serviceName}`);
  }
  const pick = instances[Math.floor(Math.random() * instances.length)];
  return pick.baseUrl.replace(/\/$/, "");
}

async function postJson(baseUrl, path, body) {
  return axios.post(`${baseUrl}${path}`, body, {
    timeout: HTTP_TIMEOUT_MS,
    headers: { "Content-Type": "application/json" },
  });
}

async function getJson(baseUrl, path) {
  return axios.get(`${baseUrl}${path}`, { timeout: HTTP_TIMEOUT_MS });
}

const app = express();
app.use(express.json());

app.post("/transaction", async (req, res) => {
  try {
    const { user_Id, amount } = req.body;

    if (user_Id === undefined || amount === undefined) {
      return res.status(400).json({ error: "user_Id and amount are required" });
    }

    const transaction_ID = Date.now().toString();
    const message = {
      transaction_ID,
      user_Id,
      amount: Number(amount),
      timestamp: transaction_ID,
      ...(req.body.msg !== undefined && { msg: req.body.msg }),
    };

    const loggingUrl = await pickServiceUrl("logging-service");
    await postJson(loggingUrl, "/log", message);

    await counterQueue.add(JSON.stringify(message));

    res.json({
      transaction_ID,
      status: "accepted",
      detail: "logged and queued for counter-service",
    });
  } catch (error) {
    console.error("POST /transaction:", error.message);
    res.status(500).json({
      error: "Failed to process transaction",
      details: error.response?.data || error.message,
    });
  }
});

app.get("/user/:user_Id", async (req, res) => {
  try {
    const { user_Id } = req.params;
    const loggingUrl = await pickServiceUrl("logging-service");
    const loggingRes = await getJson(
      loggingUrl,
      `/transactions/${encodeURIComponent(user_Id)}`,
    );
    const transactions = loggingRes.data.transactions ?? [];

    let balance = null;
    try {
      const counterUrl = await pickServiceUrl("counter-service");
      const counterRes = await getJson(
        counterUrl,
        `/balance/${encodeURIComponent(user_Id)}`,
      );
      balance = counterRes.data.balance ?? 0;
    } catch {
      balance = null;
    }

    res.json({ balance, transactions });
  } catch (error) {
    console.error("GET /user:", error.message);
    res.status(500).json({
      error: "Failed to fetch user data",
      details: error.response?.data || error.message,
    });
  }
});

app.get("/accounts", async (req, res) => {
  try {
    const counterUrl = await pickServiceUrl("counter-service");
    const counterRes = await getJson(counterUrl, "/balances");
    res.json({ balances: counterRes.data.balances ?? {} });
  } catch {
    res.json({ balances: null });
  }
});

const PORT = process.env.PORT || 3000;

async function main() {
  await initHz();
  app.listen(PORT, () => {
    console.log(`facade-service on ${PORT}, config ${CONFIG_SERVER_URL}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
