const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.SQLITE_PATH || path.join("/data", "counter.db");

function openDbReadWrite() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS balances (
      user_id TEXT PRIMARY KEY NOT NULL,
      balance REAL NOT NULL DEFAULT 0
    );
  `);
  return db;
}

function openDbReadOnly() {
  return new Database(DB_PATH, { readonly: true, fileMustExist: false });
}

function applyTransaction(db, msg) {
  const { user_Id, amount } = msg;
  if (user_Id === undefined || amount === undefined) return;
  const key = String(user_Id);
  const delta = Number(amount);
  const stmt = db.prepare(
    "UPDATE balances SET balance = balance + @d WHERE user_id = @u",
  );
  const info = stmt.run({ d: delta, u: key });
  if (info.changes === 0) {
    db.prepare("INSERT INTO balances (user_id, balance) VALUES (@u, @b)").run({
      u: key,
      b: delta,
    });
  }
}

module.exports = {
  DB_PATH,
  openDbReadWrite,
  openDbReadOnly,
  applyTransaction,
};
