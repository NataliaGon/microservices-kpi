const express = require("express");
const { Client } = require("hazelcast-client");

const app = express();
app.use(express.json());

const INSTANCE =
  process.env.LOGGING_INSTANCE || `logging-${process.pid}`;
// Must match Hazelcast member cluster name (Docker image defaults to "dev" unless overridden).
const CLUSTER_NAME = process.env.HZ_CLUSTER_NAME || "dev";
const MAP_NAME = process.env.HZ_MAP_NAME || "transactions";
const MEMBERS = (process.env.HZ_MEMBER_ADDRESSES || "localhost:5701")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectHazelcast() {
  const maxAttempts = 40;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const client = await Client.newHazelcastClient({
        clusterName: CLUSTER_NAME,
        network: {
          clusterMembers: MEMBERS,
        },
        connectionStrategy: {
          connectionRetry: {
            clusterConnectTimeoutMillis: 20000,
          },
        },
      });
      return client;
    } catch (err) {
      console.warn(
        `[${INSTANCE}] Hazelcast connect ${attempt}/${maxAttempts}:`,
        err.message,
      );
      if (attempt === maxAttempts) throw err;
      await sleep(2000);
    }
  }
}

let hzClient;
let transactionsMap;

app.post("/log", async (req, res) => {
  try {
    const message = req.body;
    const { transaction_ID } = message;

    if (!transaction_ID) {
      return res.status(400).json({ error: "transaction_ID is required" });
    }

    console.log(
      `[${INSTANCE}] POST /log transaction_ID=${transaction_ID} user_Id=${message.user_Id}`,
    );

    await transactionsMap.put(transaction_ID, message);

    res.json({ status: "ok", transaction_ID });
  } catch (err) {
    console.error(`[${INSTANCE}] POST /log error:`, err.message);
    res.status(500).json({ error: "Failed to store transaction" });
  }
});

app.get("/transactions/:user_Id", async (req, res) => {
  try {
    const { user_Id } = req.params;
    const entries = await transactionsMap.entrySet();
    const userTransactions = [];
    for (const [, tx] of entries) {
      if (tx && (tx.user_Id === user_Id || String(tx.user_Id) === String(user_Id))) {
        userTransactions.push(tx);
      }
    }
    res.json({ transactions: userTransactions });
  } catch (err) {
    console.error(`[${INSTANCE}] GET /transactions error:`, err.message);
    res.status(500).json({ error: "Failed to read transactions" });
  }
});

const PORT = process.env.PORT || 3001;

async function main() {
  console.log(
    `[${INSTANCE}] Connecting to Hazelcast cluster "${CLUSTER_NAME}" members=${MEMBERS.join(",")}`,
  );
  hzClient = await connectHazelcast();
  transactionsMap = await hzClient.getMap(MAP_NAME);
  console.log(`[${INSTANCE}] Hazelcast map ready: ${MAP_NAME}`);

  app.listen(PORT, () => {
    console.log(`[${INSTANCE}] Logging service listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error(`[${INSTANCE}] Fatal:`, err);
  process.exit(1);
});

async function shutdown() {
  console.log(`[${INSTANCE}] Shutting down...`);
  try {
    if (hzClient) await hzClient.shutdown();
  } catch (e) {
    /* ignore */
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
