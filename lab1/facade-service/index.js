const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const LOGGING_SERVICE_URL =
  process.env.LOGGING_SERVICE_URL || "http://localhost:3001";
const COUNTER_SERVICE_URL =
  process.env.COUNTER_SERVICE_URL || "http://localhost:3002";

let totalLoggingTime = 0;
let totalCounterTime = 0;
let loggingCallCount = 0;
let counterCallCount = 0;

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
    };

    const loggingStart = Date.now();
    const counterStart = Date.now();

    const [, counterResponse] = await Promise.all([
      axios.post(`${LOGGING_SERVICE_URL}/log`, message),
      axios.post(`${COUNTER_SERVICE_URL}/transaction`, message),
    ]);

    totalLoggingTime += Date.now() - loggingStart;
    totalCounterTime += Date.now() - counterStart;
    loggingCallCount++;
    counterCallCount++;

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

// Get balance and transactions for a user
app.get("/user/:user_Id", async (req, res) => {
  try {
    const { user_Id } = req.params;

    const loggingStart = Date.now();
    const counterStart = Date.now();

    const [loggingRes, counterResponse] = await Promise.all([
      axios.get(`${LOGGING_SERVICE_URL}/transactions/${user_Id}`),
      axios.get(`${COUNTER_SERVICE_URL}/balance/${user_Id}`),
    ]);

    totalLoggingTime += Date.now() - loggingStart;
    totalCounterTime += Date.now() - counterStart;
    loggingCallCount++;
    counterCallCount++;

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

// Get balances of all clients
app.get("/accounts", async (req, res) => {
  try {
    const counterStart = Date.now();

    const counterResponse = await axios.get(`${COUNTER_SERVICE_URL}/balances`);
    totalCounterTime += Date.now() - counterStart;
    counterCallCount++;

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

// Get timing statistics
// Note: Logging and Counter are called in PARALLEL (Promise.all), so both timers
// measure the same span per request. totalTimeMs = sum of request durations (can
// exceed wall clock when many requests run concurrently).
app.get("/stats", (req, res) => {
  const totalParallelMs =
    Math.max(totalLoggingTime, totalCounterTime) || totalLoggingTime || totalCounterTime;
  res.json({
    _note:
      "Logging and Counter run in PARALLEL — totalTimeMs is accumulated per-request duration (sum), NOT additive. avgTimeMs is per-request.",
    logging: {
      totalTimeMs: totalLoggingTime,
      callCount: loggingCallCount,
      avgTimeMs:
        loggingCallCount > 0
          ? (totalLoggingTime / loggingCallCount).toFixed(2)
          : 0,
    },
    counter: {
      totalTimeMs: totalCounterTime,
      callCount: counterCallCount,
      avgTimeMs:
        counterCallCount > 0
          ? (totalCounterTime / counterCallCount).toFixed(2)
          : 0,
    },
    // Combined view: effective time (same for both, since parallel)
    effective: {
      totalAccumulatedMs: totalParallelMs,
      callCount: loggingCallCount,
      avgPerRequestMs:
        loggingCallCount > 0
          ? (totalParallelMs / loggingCallCount).toFixed(2)
          : 0,
    },
  });
});

// Reset timing statistics
app.post("/stats/reset", (req, res) => {
  totalLoggingTime = 0;
  totalCounterTime = 0;
  loggingCallCount = 0;
  counterCallCount = 0;
  res.json({ message: "Stats reset successfully" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Facade service running on port ${PORT}`);
});
