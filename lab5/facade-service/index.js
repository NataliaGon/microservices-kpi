const express = require("express");
const axios = require("axios");
const { Client } = require("hazelcast-client");

const CONSUL_HTTP_ADDR = process.env.CONSUL_HTTP_ADDR || "http://consul:8500";
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 5000);
const PORT = Number(process.env.PORT || 3000);
const SERVICE_NAME = process.env.SERVICE_NAME || "facade-service";
const SERVICE_ID =
  process.env.SERVICE_ID || `${SERVICE_NAME}-${process.env.HOSTNAME || PORT}`;
const SERVICE_ADDRESS = process.env.SERVICE_ADDRESS || process.env.HOSTNAME;

let hzClient;
let counterQueue;
const callStats = {
  logging: { totalMs: 0, count: 0 },
  counter: { totalMs: 0, count: 0 },
};

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

async function initHzAndQueue() {
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
  counterQueue = await hzClient.getQueue(counterQueueName);
  console.log(
    `[facade] Hazelcast connected, queue=${counterQueueName}, members=${hzMembers.join(",")}`,
  );
}

async function registerInConsul() {
  if (!SERVICE_ADDRESS) {
    console.warn("[facade] SERVICE_ADDRESS is empty, skipping Consul registration");
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
      console.log(`[facade] registered in Consul as ${SERVICE_ID}`);
      return;
    } catch {
      console.log(`[facade] register retry ${i + 1}/30...`);
      await sleep(2000);
    }
  }
  throw new Error("Consul registration failed for facade-service");
}

async function pickServiceUrl(serviceName) {
  const { data } = await axios.get(
    `${CONSUL_HTTP_ADDR}/v1/health/service/${encodeURIComponent(serviceName)}?passing=true`,
    { timeout: HTTP_TIMEOUT_MS },
  );
  const instances = (data || [])
    .map((entry) => {
      const host = entry?.Service?.Address || entry?.Node?.Address;
      const port = entry?.Service?.Port;
      if (!host || !port) return null;
      return `http://${host}:${port}`;
    })
    .filter(Boolean);
  if (!instances.length) {
    throw new Error(`No instances registered for ${serviceName}`);
  }
  return instances[Math.floor(Math.random() * instances.length)];
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

async function withTimedCall(target, fn) {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    callStats[target].totalMs += Date.now() - started;
    callStats[target].count += 1;
  }
}

function formatStatsSection(section) {
  const avgTimeMs = section.count ? Number((section.totalMs / section.count).toFixed(3)) : 0;
  return {
    calls: section.count,
    totalMs: Number(section.totalMs.toFixed(3)),
    avgTimeMs,
  };
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: SERVICE_NAME, id: SERVICE_ID });
});

app.get("/stats", (_req, res) => {
  res.json({
    logging: formatStatsSection(callStats.logging),
    counter: formatStatsSection(callStats.counter),
  });
});

app.post("/stats/reset", (_req, res) => {
  callStats.logging.totalMs = 0;
  callStats.logging.count = 0;
  callStats.counter.totalMs = 0;
  callStats.counter.count = 0;
  res.json({ ok: true });
});

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
    await withTimedCall("logging", () => postJson(loggingUrl, "/log", message));

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
    const loggingRes = await withTimedCall("logging", () =>
      getJson(loggingUrl, `/transactions/${encodeURIComponent(user_Id)}`),
    );
    const transactions = loggingRes.data.transactions ?? [];

    let balance = null;
    try {
      const counterUrl = await pickServiceUrl("counter-service");
      const counterRes = await withTimedCall("counter", () =>
        getJson(counterUrl, `/balance/${encodeURIComponent(user_Id)}`),
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
    const counterRes = await withTimedCall("counter", () =>
      getJson(counterUrl, "/balances"),
    );
    res.json({ balances: counterRes.data.balances ?? {} });
  } catch {
    res.json({ balances: null });
  }
});

async function main() {
  await initHzAndQueue();
  await registerInConsul();
  app.listen(PORT, () => {
    console.log(`[facade] HTTP on ${PORT}, consul ${CONSUL_HTTP_ADDR}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
