const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://counter:counter@localhost:5432/counterdb",
});

app.post("/transaction", async (req, res) => {
  const { user_Id, amount } = req.body;

  if (user_Id === undefined || amount === undefined) {
    return res.status(400).json({ error: "user_Id and amount are required" });
  }

  const uid = String(user_Id);
  const delta = Number(amount);

  try {
    const result = await pool.query(
      `INSERT INTO accounts (user_id, balance) VALUES ($1, $2::numeric)
       ON CONFLICT (user_id) DO UPDATE
         SET balance = accounts.balance + EXCLUDED.balance
       RETURNING balance`,
      [uid, delta],
    );
    const balance = parseFloat(result.rows[0].balance, 10);
    res.json({ balance });
  } catch (err) {
    console.error("POST /transaction:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/balance/:user_Id", async (req, res) => {
  const { user_Id } = req.params;
  const uid = String(user_Id);

  try {
    const result = await pool.query(
      "SELECT balance FROM accounts WHERE user_id = $1",
      [uid],
    );
    const balance =
      result.rows.length > 0 ? parseFloat(result.rows[0].balance, 10) : 0;
    res.json({ balance });
  } catch (err) {
    console.error("GET /balance:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/balances", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT user_id, balance FROM accounts ORDER BY user_id",
    );
    const balances = {};
    for (const row of result.rows) {
      balances[row.user_id] = parseFloat(row.balance, 10);
    }
    res.json({ balances });
  } catch (err) {
    console.error("GET /balances:", err.message);
    res.status(500).json({ error: "Database error" });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Counter service (PostgreSQL) listening on port ${PORT}`);
});
