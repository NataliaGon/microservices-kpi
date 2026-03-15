// Part I - Distributed Map
const MAP_NAME = 'lab2-distributed-map';
const NUM_ENTRIES = 10_000;

// Part II - Counter Service
const COUNTER_MAP = 'counter-map';
const COUNTER_KEY = 'likes';
const LOCK_NAME = 'counter-lock';
const ITERATION_NAME = 'iteration';
const TARGET = 100_000;
const SLEEP_MS = 1; // 1 = ~2 min (time to kill services for failover), 0 = ~15 sec

module.exports = {
  MAP_NAME,
  NUM_ENTRIES,
  COUNTER_MAP,
  COUNTER_KEY,
  LOCK_NAME,
  ITERATION_NAME,
  TARGET,
  SLEEP_MS,
};
