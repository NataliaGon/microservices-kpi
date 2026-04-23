const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

function parseLoggingUrls() {
  const raw =
    process.env.LOGGING_SERVICE_URLS ||
    process.env.LOGGING_SERVICE_URL ||
    "http://localhost:3001";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((u) => u.replace(/\/$/, ""));
}

function shuffleOrder(urls) {
  const copy = [...urls];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS) || 8000;

async function loggingPost(path, data) {
  const bases = parseLoggingUrls();
  const order = shuffleOrder(bases);
  let lastError;
  for (const base of order) {
    try {
      return await axios.post(`${base}${path}`, data, {
        timeout: HTTP_TIMEOUT_MS,
      });
    } catch (err) {
      lastError = err;
      console.warn(
        `[facade] logging POST ${base}${path} failed (${err.code || err.message}), trying next`,
      );
    }
  }
  throw lastError;
}

async function loggingGet(path) {
  const bases = parseLoggingUrls();
  const order = shuffleOrder(bases);
  let lastError;
  for (const base of order) {
    try {
      return await axios.get(`${base}${path}`, {
        timeout: HTTP_TIMEOUT_MS,
      });
    } catch (err) {
      lastError = err;
      console.warn(
        `[facade] logging GET ${base}${path} failed (${err.code || err.message}), trying next`,
      );
    }
  }
  throw lastError;
}

const COUNTER_SERVICE_URL = (
  process.env.COUNTER_SERVICE_URL || "http://localhost:3002"
).replace(/\/$/, "");

let totalLoggingTime = 0;
let totalCounterTime = 0;
let loggingCallCount = 0;
let counterCallCount = 0;

async function withServiceTiming(target, fn) {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    const elapsed = Date.now() - started;
    if (target === "logging") {
      totalLoggingTime += elapsed;
      loggingCallCount++;
    } else if (target === "counter") {
      totalCounterTime += elapsed;
      counterCallCount++;
    }
  }
}

app.post("/transaction", async (req, res) => {
  try {
    const { user_Id, amount, msg } = req.body;

    if (user_Id === undefined || amount === undefined) {
      return res.status(400).json({ error: "user_Id and amount are required" });
    }

    const transaction_ID = Date.now().toString();

    const message = {
      transaction_ID,
      user_Id,
      amount: Number(amount),
      timestamp: transaction_ID,
      ...(msg !== undefined && { msg }),
    };

    const [, counterResponse] = await Promise.all([
      withServiceTiming("logging", () => loggingPost("/log", message)),
      withServiceTiming("counter", () =>
        axios.post(`${COUNTER_SERVICE_URL}/transaction`, message, {
          timeout: HTTP_TIMEOUT_MS,
        }),
      ),
    ]);

    const balance = counterResponse.data.balance;

    res.json({ transaction_ID, balance });
  } catch (error) {
    console.error("Error processing transaction:", error.message);
    res.status(500).json({
      error: "Failed to process transaction",
      details: error.response?.data || error.message,
    });
  }
});

app.get("/user/:user_Id", async (req, res) => {
  try {
    const { user_Id } = req.params;

    const [loggingRes, counterResponse] = await Promise.all([
      withServiceTiming("logging", () =>
        loggingGet(`/transactions/${encodeURIComponent(user_Id)}`),
      ),
      withServiceTiming("counter", () =>
        axios.get(`${COUNTER_SERVICE_URL}/balance/${encodeURIComponent(user_Id)}`, {
          timeout: HTTP_TIMEOUT_MS,
        }),
      ),
    ]);

    const balance = counterResponse.data.balance ?? 0;
    const transactions = loggingRes.data.transactions ?? [];

    res.json({ balance, transactions });
  } catch (error) {
    console.error("Error fetching user data:", error.message);
    res.status(500).json({
      error: "Failed to fetch user data",
      details: error.response?.data || error.message,
    });
  }
});

app.get("/accounts", async (req, res) => {
  try {
    const counterResponse = await withServiceTiming("counter", () =>
      axios.get(`${COUNTER_SERVICE_URL}/balances`, {
        timeout: HTTP_TIMEOUT_MS,
      }),
    );

    const balances = counterResponse.data.balances ?? {};

    res.json({ balances });
  } catch (error) {
    console.error("Error fetching accounts:", error.message);
    res.status(500).json({
      error: "Failed to fetch accounts",
      details: error.response?.data || error.message,
    });
  }
});

app.get("/stats", (req, res) => {
  res.json({
    logging: {
      totalTimeMs: totalLoggingTime,
      callCount: loggingCallCount,
      avgTimeMs:
        loggingCallCount > 0
          ? (totalLoggingTime / loggingCallCount).toFixed(2)
          : "0",
    },
    counter: {
      totalTimeMs: totalCounterTime,
      callCount: counterCallCount,
      avgTimeMs:
        counterCallCount > 0
          ? (totalCounterTime / counterCallCount).toFixed(2)
          : "0",
    },
  });
});

app.post("/stats/reset", (req, res) => {
  totalLoggingTime = 0;
  totalCounterTime = 0;
  loggingCallCount = 0;
  counterCallCount = 0;
  res.json({ message: "Stats reset successfully" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Facade service on port ${PORT}`);
  console.log(`Logging targets (random + failover): ${parseLoggingUrls().join(", ")}`);
});
