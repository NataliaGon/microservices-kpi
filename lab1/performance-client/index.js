#!/usr/bin/env node
const axios = require("axios");

const FACADE_URL = process.env.FACADE_URL || "http://localhost:3000";
const CLIENTS = Number(process.env.CLIENTS || 10);
const TX_PER_CLIENT = Number(process.env.TX_PER_CLIENT || 10000);

async function runTransaction(userId, amount) {
  const response = await axios.post(`${FACADE_URL}/transaction`, {
    user_Id: userId,
    amount,
  });
  return response.data;
}

async function runScenario1() {
  // 10 clients, each makes N transactions adding 1 to their own account
  const numClients = CLIENTS;
  const transactionsPerClient = TX_PER_CLIENT;

  console.log(
    "\n=== Scenario 1: 10 clients, 10K transactions each (own account) ===",
  );
  console.log(`Expected: 10 accounts with 10,000 balance each\n`);

  try {
    await axios.post(`${FACADE_URL}/stats/reset`);
  } catch {
    /* optional */
  }

  const startTime = Date.now();

  const clientPromises = [];
  for (let clientId = 0; clientId < numClients; clientId++) {
    const userId = `user_${clientId}`;
    const promise = (async () => {
      for (let i = 0; i < transactionsPerClient; i++) {
        await runTransaction(userId, 1);
      }
    })();
    clientPromises.push(promise);
  }

  await Promise.all(clientPromises);

  const totalTime = (Date.now() - startTime) / 1000;
  const totalRequests = numClients * transactionsPerClient;
  const requestsPerSecond = (totalRequests / totalTime).toFixed(2);

  console.log(`Total time: ${totalTime.toFixed(2)} seconds`);
  console.log(`Total requests: ${totalRequests}`);
  console.log(`Requests per second: ${requestsPerSecond}`);

  const accountsRes = await axios.get(`${FACADE_URL}/accounts`);
  const balances = accountsRes.data.balances;
  console.log("\nFinal balances:", balances);

  try {
    const { data } = await axios.get(`${FACADE_URL}/stats`);
    console.log(
      `Facade avg (ms/call): logging ${data.logging.avgTimeMs} | counter ${data.counter.avgTimeMs}`,
    );
  } catch (e) {
    /* optional */
  }

  let stats = null;
  try {
    const { data } = await axios.get(`${FACADE_URL}/stats`);
    stats = data;
  } catch {
    /* optional */
  }

  const result = {
    totalRequests,
    totalTimeSec: Number(totalTime.toFixed(3)),
    rps: Number(requestsPerSecond),
    loggingContributionMsPerCall: Number(stats?.logging?.avgTimeMs || 0),
    counterContributionMsPerCall: Number(stats?.counter?.avgTimeMs || 0),
    loggingTotalMs: Number(stats?.logging?.totalTimeMs || 0),
    counterTotalMs: Number(stats?.counter?.totalTimeMs || 0),
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runScenario2() {
  // 10 clients, each makes N transactions adding 1 to the SAME account
  const numClients = CLIENTS;
  const transactionsPerClient = TX_PER_CLIENT;
  const sharedUserId = "shared_user";

  console.log(
    "\n=== Scenario 2: 10 clients, 10K transactions each (same account) ===",
  );
  console.log(`Expected: 1 account with 100,000 balance\n`);

  // Reset stats before test
  try {
    await axios.post(`${FACADE_URL}/stats/reset`);
  } catch (e) {}

  const startTime = Date.now();

  const clientPromises = [];
  for (let clientId = 0; clientId < numClients; clientId++) {
    const promise = (async () => {
      for (let i = 0; i < transactionsPerClient; i++) {
        await runTransaction(sharedUserId, 1);
      }
    })();
    clientPromises.push(promise);
  }

  await Promise.all(clientPromises);

  const totalTime = (Date.now() - startTime) / 1000;
  const totalRequests = numClients * transactionsPerClient;
  const requestsPerSecond = (totalRequests / totalTime).toFixed(2);

  console.log(`Total time: ${totalTime.toFixed(2)} seconds`);
  console.log(`Total requests: ${totalRequests}`);
  console.log(`Requests per second: ${requestsPerSecond}`);

  // Verify results
  const userRes = await axios.get(`${FACADE_URL}/user/${sharedUserId}`);
  console.log("\nFinal balance for shared_user:", userRes.data.balance);

  try {
    const { data } = await axios.get(`${FACADE_URL}/stats`);
    console.log(
      `Facade avg (ms/call): logging ${data.logging.avgTimeMs} | counter ${data.counter.avgTimeMs}`,
    );
  } catch (e) {
    /* optional */
  }

  let stats = null;
  try {
    const { data } = await axios.get(`${FACADE_URL}/stats`);
    stats = data;
  } catch {
    /* optional */
  }

  const result = {
    totalRequests,
    totalTimeSec: Number(totalTime.toFixed(3)),
    rps: Number(requestsPerSecond),
    loggingContributionMsPerCall: Number(stats?.logging?.avgTimeMs || 0),
    counterContributionMsPerCall: Number(stats?.counter?.avgTimeMs || 0),
    loggingTotalMs: Number(stats?.logging?.totalTimeMs || 0),
    counterTotalMs: Number(stats?.counter?.totalTimeMs || 0),
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const scenario = process.argv.includes("--scenario")
    ? parseInt(process.argv[process.argv.indexOf("--scenario") + 1], 10)
    : null;

  console.log(`Performance client - Facade URL: ${FACADE_URL}`);

  if (scenario === 1) {
    await runScenario1();
  } else if (scenario === 2) {
    await runScenario2();
  } else {
    console.log("Running both scenarios...");
    await runScenario1();
    await runScenario2();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  if (err.code === "ECONNREFUSED") {
    console.error("Make sure the services are running: docker-compose up -d");
  }
  process.exit(1);
});
