const http = require("http");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const ROLE = process.env.ROLE || "master";
const SECONDARIES = (process.env.SECONDARIES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const REPLICATION_TIMEOUT_MS = Number(process.env.REPLICATION_TIMEOUT_MS || 1500);
const RETRY_BASE_DELAY_MS = Number(process.env.RETRY_BASE_DELAY_MS || 300);
const RETRY_MAX_DELAY_MS = Number(process.env.RETRY_MAX_DELAY_MS || 5000);
const APPLY_DELAY_MS = Number(process.env.APPLY_DELAY_MS || 0);
const RANDOM_ERROR_PROB = Number(process.env.RANDOM_ERROR_PROB || 0);

function log(message, extra = {}) {
  const payload = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
  // Keep logs compact and machine-parsable.
  console.log(`[${new Date().toISOString()}] [${ROLE}] ${message}${payload}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", (err) => reject(err));
  });
}

function postJson(urlString, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("Timeout"));
    });
    req.on("error", (err) => reject(err));
    req.write(data);
    req.end();
  });
}

function createMasterState() {
  return {
    seqCounter: 0,
    logEntries: [],
    waiters: new Map(),
    secondaries: SECONDARIES.map((baseUrl) => ({
      baseUrl,
      nextIndex: 0,
      retryDelay: RETRY_BASE_DELAY_MS,
      active: false,
    })),
  };
}

function createSecondaryState() {
  return {
    bySeq: new Map(),
    seenIds: new Set(),
    visibleMessages: [],
    nextVisibleSeq: 1,
  };
}

function startMaster() {
  const state = createMasterState();

  function notifyAck(messageId, secondaryUrl) {
    const waiter = state.waiters.get(messageId);
    if (!waiter) return;
    waiter.ackedSecondaries.add(secondaryUrl);
    if (waiter.ackedSecondaries.size >= waiter.requiredSecondaryAcks) {
      waiter.resolve();
      state.waiters.delete(messageId);
    }
  }

  async function runSecondaryWorker(secondary) {
    if (secondary.active) return;
    secondary.active = true;

    while (true) {
      if (secondary.nextIndex >= state.logEntries.length) {
        await sleep(50);
        continue;
      }

      const entry = state.logEntries[secondary.nextIndex];
      try {
        await postJson(
          `${secondary.baseUrl}/replicate`,
          entry,
          REPLICATION_TIMEOUT_MS
        );
        notifyAck(entry.id, secondary.baseUrl);
        secondary.nextIndex += 1;
        secondary.retryDelay = RETRY_BASE_DELAY_MS;
      } catch (err) {
        log("Replication failed; retrying", {
          secondary: secondary.baseUrl,
          seq: entry.seq,
          error: err.message,
          retryDelayMs: secondary.retryDelay,
        });
        await sleep(secondary.retryDelay);
        secondary.retryDelay = Math.min(
          RETRY_MAX_DELAY_MS,
          Math.max(RETRY_BASE_DELAY_MS, Math.floor(secondary.retryDelay * 1.8))
        );
      }
    }
  }

  for (const secondary of state.secondaries) {
    runSecondaryWorker(secondary).catch((err) => {
      log("Secondary worker crashed", {
        secondary: secondary.baseUrl,
        error: err.message,
      });
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/messages") {
      return sendJson(res, 200, {
        role: "master",
        count: state.logEntries.length,
        messages: state.logEntries.map((e) => ({
          id: e.id,
          seq: e.seq,
          message: e.message,
        })),
      });
    }

    if (req.method === "POST" && url.pathname === "/messages") {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      const message = typeof body.message === "string" ? body.message.trim() : "";
      const w = Number(body.w ?? 1);
      if (!message) {
        return sendJson(res, 400, { error: "message is required" });
      }
      if (!Number.isInteger(w) || w < 1) {
        return sendJson(res, 400, { error: "w must be an integer >= 1" });
      }

      state.seqCounter += 1;
      const entry = {
        id: `${state.seqCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        seq: state.seqCounter,
        message,
        createdAt: new Date().toISOString(),
      };
      state.logEntries.push(entry);

      const maxSupportedW = state.secondaries.length + 1;
      const effectiveW = Math.min(w, maxSupportedW);
      const requiredSecondaryAcks = Math.max(0, effectiveW - 1);

      if (requiredSecondaryAcks === 0) {
        return sendJson(res, 201, {
          status: "accepted",
          writeConcern: w,
          effectiveWriteConcern: effectiveW,
          requiredSecondaryAcks,
          entry,
        });
      }

      const ackPromise = new Promise((resolve) => {
        state.waiters.set(entry.id, {
          requiredSecondaryAcks,
          ackedSecondaries: new Set(),
          resolve,
        });
      });

      await ackPromise;

      return sendJson(res, 201, {
        status: "replicated",
        writeConcern: w,
        effectiveWriteConcern: effectiveW,
        requiredSecondaryAcks,
        entry,
      });
    }

    sendJson(res, 404, { error: "Not found" });
  });

  server.listen(PORT, () => {
    log("Master listening", { port: PORT, secondaries: SECONDARIES });
  });
}

function startSecondary() {
  const state = createSecondaryState();

  function flushVisible() {
    while (state.bySeq.has(state.nextVisibleSeq)) {
      const entry = state.bySeq.get(state.nextVisibleSeq);
      state.bySeq.delete(state.nextVisibleSeq);
      state.visibleMessages.push({
        id: entry.id,
        seq: entry.seq,
        message: entry.message,
      });
      state.nextVisibleSeq += 1;
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/messages") {
      return sendJson(res, 200, {
        role: "secondary",
        count: state.visibleMessages.length,
        messages: state.visibleMessages,
      });
    }

    if (req.method === "POST" && url.pathname === "/replicate") {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      const id = typeof body.id === "string" ? body.id : "";
      const seq = Number(body.seq);
      const message = typeof body.message === "string" ? body.message : "";
      if (!id || !Number.isInteger(seq) || seq < 1 || !message) {
        return sendJson(res, 400, { error: "Invalid replication payload" });
      }

      if (APPLY_DELAY_MS > 0) {
        await sleep(APPLY_DELAY_MS);
      }

      if (!state.seenIds.has(id)) {
        state.seenIds.add(id);
        if (!state.bySeq.has(seq)) {
          state.bySeq.set(seq, { id, seq, message });
        }
        flushVisible();
      }

      if (RANDOM_ERROR_PROB > 0 && Math.random() < RANDOM_ERROR_PROB) {
        log("Injected error after apply", { seq, id });
        return sendJson(res, 500, { error: "Injected post-apply failure" });
      }

      return sendJson(res, 200, { ack: true, id, seq });
    }

    sendJson(res, 404, { error: "Not found" });
  });

  server.listen(PORT, () => {
    log("Secondary listening", {
      port: PORT,
      delayMs: APPLY_DELAY_MS,
      randomErrorProb: RANDOM_ERROR_PROB,
    });
  });
}

if (ROLE === "master") {
  startMaster();
} else if (ROLE === "secondary") {
  startSecondary();
} else {
  throw new Error(`Unknown ROLE: ${ROLE}`);
}
