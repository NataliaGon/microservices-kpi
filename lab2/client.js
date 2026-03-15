const { Client } = require("hazelcast-client");

const members = (process.env.HZ_MEMBERS || "hz1:5701,hz2:5701,hz3:5701").split(
  ",",
);

async function createClient() {
  return await Client.newHazelcastClient({
    clusterName: "dev",
    network: { clusterMembers: members },
  });
}

module.exports = { createClient };
