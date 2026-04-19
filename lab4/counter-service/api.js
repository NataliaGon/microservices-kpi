const express = require("express");
const axios = require("axios");
const { openDbReadOnly, DB_PATH } = require("./store");

const CONFIG_SERVER_URL =
  process.env.CONFIG_SERVER_URL || "http://localhost:4000";
const REGISTER_URL = process.env.PUBLIC_BASE_URL;

const app = express();

async function register() {
  if (!REGISTER_URL) {
    console.warn("[counter-api] PUBLIC_BASE_URL not set, skip registration");
    return;
  }
  for (let i = 0; i < 30; i++) {
    try {
      await axios.post(`${CONFIG_SERVER_URL}/register`, {
        serviceName: "counter-service",
        baseUrl: REGISTER_URL,
      });
      console.log(`[counter-api] registered at ${REGISTER_URL}`);
      return;
    } catch {
      console.log(`[counter-api] register retry ${i + 1}/30...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("config-server registration failed");
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

const PORT = process.env.PORT || 3002;

async function main() {
  await register();
  app.listen(PORT, () => {
    console.log(`[counter-api] HTTP on ${PORT}, read DB ${DB_PATH}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
