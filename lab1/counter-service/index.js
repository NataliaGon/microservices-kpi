const express = require("express");

const app = express();
app.use(express.json());

const balances = new Map();

app.post("/transaction", (req, res) => {
  const { user_Id, amount } = req.body;

  if (user_Id === undefined || amount === undefined) {
    return res.status(400).json({ error: "user_Id and amount are required" });
  }

  const key = String(user_Id);
  const currentBalance = balances.get(key) || 0;
  const newBalance = currentBalance + Number(amount);

  balances.set(key, newBalance);

  res.json({ balance: newBalance });
});

app.get("/balance/:user_Id", (req, res) => {
  const { user_Id } = req.params;
  const key = String(user_Id);
  const balance = balances.get(key) || 0;

  res.json({ balance });
});

app.get("/balances", (req, res) => {
  const result = {};
  for (const [user_Id, balance] of balances) {
    result[user_Id] = balance;
  }
  res.json({ balances: result });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Counter service running on port ${PORT}`);
});
