const express = require("express");

const app = express();
app.use(express.json());

/** @type {Map<string, Set<string>>} */
const registry = new Map();

function addInstance(serviceName, baseUrl) {
  const url = String(baseUrl).replace(/\/$/, "");
  if (!registry.has(serviceName)) {
    registry.set(serviceName, new Set());
  }
  registry.get(serviceName).add(url);
  console.log(`[config-server] registered ${serviceName} -> ${url}`);
}

app.post("/register", (req, res) => {
  const { serviceName, baseUrl } = req.body || {};
  if (!serviceName || !baseUrl) {
    return res.status(400).json({ error: "serviceName and baseUrl required" });
  }
  addInstance(serviceName, baseUrl);
  res.json({ ok: true, serviceName, baseUrl });
});

app.get("/services/:serviceName", (req, res) => {
  const { serviceName } = req.params;
  const set = registry.get(serviceName);
  const instances = set ? [...set].map((baseUrl) => ({ baseUrl })) : [];
  res.json({ serviceName, instances });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, services: [...registry.keys()] });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`config-server listening on ${PORT}`);
});
