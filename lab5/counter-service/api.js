const express = require("express");
const axios = require("axios");
const { openDbReadOnly, DB_PATH } = require("./store");

const CONSUL_HTTP_ADDR = process.env.CONSUL_HTTP_ADDR || "http://consul:8500";
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 5000);
const PORT = Number(process.env.PORT || 3002);
const SERVICE_NAME = process.env.SERVICE_NAME || "counter-service";
const SERVICE_ID =
  process.env.SERVICE_ID || `${SERVICE_NAME}-${process.env.HOSTNAME || PORT}`;
const SERVICE_ADDRESS = process.env.SERVICE_ADDRESS || process.env.HOSTNAME;

const app = express();

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

async function register() {
  if (!SERVICE_ADDRESS) {
    console.warn("[counter-api] SERVICE_ADDRESS empty, skip Consul registration");
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
      console.log(`[counter-api] registered in Consul as ${SERVICE_ID}`);
      return;
    } catch {
      console.log(`[counter-api] register retry ${i + 1}/30...`);
      await sleep(2000);
    }
  }
  throw new Error("Consul registration failed for counter-service");
}

function openFreshReadDb() {
  try {
    return openDbReadOnly();
  } catch {
    return null;
  }
}

app.get("/balance/:user_Id", (req, res) => {
  const db = openFreshReadDb();
  if (!db) {
    return res.json({ balance: 0 });
  }
  try {
    const { user_Id } = req.params;
    const row = db
      .prepare("SELECT balance FROM balances WHERE user_id = ?")
      .get(String(user_Id));
    const balance = row ? row.balance : 0;
    res.json({ balance });
  } finally {
    db.close();
  }
});

app.get("/balances", (_req, res) => {
  const db = openFreshReadDb();
  if (!db) {
    return res.json({ balances: {} });
  }
  try {
    const rows = db.prepare("SELECT user_id, balance FROM balances").all();
    const balances = {};
    for (const r of rows) {
      balances[r.user_id] = r.balance;
    }
    res.json({ balances });
  } finally {
    db.close();
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: SERVICE_NAME, id: SERVICE_ID });
});

async function main() {
  const queueName = await readKv("config/mq/queue/name", "lab5-counter-queue");
  console.log(`[counter-api] MQ queue config from Consul: ${queueName}`);
  await register();
  app.listen(PORT, () => {
    console.log(`[counter-api] HTTP on ${PORT}, read DB ${DB_PATH}, consul ${CONSUL_HTTP_ADDR}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
