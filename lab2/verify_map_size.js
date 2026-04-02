const { Client } = require("hazelcast-client");
const members = (process.env.HZ_MEMBERS || "hz1:5701,hz2:5701,hz3:5701").split(
  ",",
);

(async () => {
  const client = await Client.newHazelcastClient({
    clusterName: "dev",
    network: { clusterMembers: members.filter(Boolean) },
  });
  const map = await client.getMap("lab2-distributed-map");
  const size = await map.size();
  console.log("Map size:", size);
  await client.shutdown();
})();
