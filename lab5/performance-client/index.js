const axios = require("axios");

const FACADE_URL = process.env.FACADE_URL || "http://localhost:3000";
const CLIENTS = Number(process.env.CLIENTS || 10);
const TX_PER_CLIENT = Number(process.env.TX_PER_CLIENT || 1000);
const READ_PASSES = Number(process.env.READ_PASSES || 3);

async function runTransaction(userId, amount) {
  await axios.post(`${FACADE_URL}/transaction`, {
    user_Id: userId,
    amount,
  });
}

async function readUser(userId) {
  await axios.get(`${FACADE_URL}/user/${encodeURIComponent(userId)}`);
}

function summarizeStats(stats) {
  return {
    loggingAvgMs: stats?.logging?.avgTimeMs ?? 0,
    counterAvgMs: stats?.counter?.avgTimeMs ?? 0,
    loggingTotalMs: stats?.logging?.totalMs ?? 0,
    counterTotalMs: stats?.counter?.totalMs ?? 0,
  };
}

async function runScenario({ name, userForClient }) {
  console.log(`\n=== ${name} ===`);
  console.log(
    `clients=${CLIENTS}, tx/client=${TX_PER_CLIENT}, total=${CLIENTS * TX_PER_CLIENT}`,
  );

  await axios.post(`${FACADE_URL}/stats/reset`);
  const started = Date.now();

  const jobs = [];
  const users = new Set();
  for (let clientId = 0; clientId < CLIENTS; clientId++) {
    jobs.push(
      (async () => {
        const userId = userForClient(clientId);
        users.add(userId);
        for (let i = 0; i < TX_PER_CLIENT; i++) {
          await runTransaction(userId, 1);
        }
      })(),
    );
  }
  await Promise.all(jobs);

  // Force synchronous read-path calls so counter-service contribution is measurable.
  const userList = [...users];
  for (let pass = 0; pass < READ_PASSES; pass++) {
    await Promise.all(userList.map((u) => readUser(u)));
  }

  const totalTimeMs = Date.now() - started;
  const { data: stats } = await axios.get(`${FACADE_URL}/stats`);
  const s = summarizeStats(stats);
  const totalRequests = CLIENTS * TX_PER_CLIENT;

  const result = {
    totalRequests,
    totalTimeSec: Number((totalTimeMs / 1000).toFixed(3)),
    rps: Number((totalRequests / (totalTimeMs / 1000)).toFixed(2)),
    loggingContributionMsPerCall: s.loggingAvgMs,
    counterContributionMsPerCall: s.counterAvgMs,
    loggingTotalMs: s.loggingTotalMs,
    counterTotalMs: s.counterTotalMs,
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  console.log(`Performance client for ${FACADE_URL}`);
  const scenarioArg = process.argv.includes("--scenario")
    ? process.argv[process.argv.indexOf("--scenario") + 1]
    : "all";

  if (scenarioArg === "10-accounts" || scenarioArg === "all") {
    await runScenario({
      name: "Scenario A (10 accounts)",
      userForClient: (id) => `user_${id}`,
    });
  }

  if (scenarioArg === "1-account" || scenarioArg === "all") {
    await runScenario({
      name: "Scenario B (1 account)",
      userForClient: () => "shared_user",
    });
  }
}

main().catch((err) => {
  console.error("Performance test failed:", err.message);
  process.exit(1);
});
