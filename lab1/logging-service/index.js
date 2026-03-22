const express = require("express");

const app = express();
app.use(express.json());

const transactions = new Map();

app.post("/log", (req, res) => {
  const message = req.body;
  const { transaction_ID } = message;

  if (!transaction_ID) {
    return res.status(400).json({ error: "transaction_ID is required" });
  }

  transactions.set(transaction_ID, message);

  res.json({ status: "ok", transaction_ID });
});

// Get all transactions for a user
app.get("/transactions/:user_Id", (req, res) => {
  const { user_Id } = req.params;

  const userTransactions = [];
  for (const [, tx] of transactions) {
    if (tx.user_Id === user_Id || String(tx.user_Id) === String(user_Id)) {
      userTransactions.push(tx);
    }
  }

  res.json({ transactions: userTransactions });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Logging service running on port ${PORT}`);
});
