# Task 1 - Microservices Basics (Banking System)

Three microservices implementing a simple banking system with REST API.

## Architecture

- **facade-service** (port 3000) - Accepts POST/GET transactions from clients, orchestrates logging and counter services
- **logging-service** (port 3001) - Stores all transactions in memory
- **counter-service** (port 3002) - Calculates and stores account balances

## Quick Start with Docker

```bash
docker-compose up -d
```

## API Reference

### POST /transaction
Submit a transaction. Format: `{ "user_Id": "user1", "amount": 100 }` (positive = deposit, negative = withdrawal)

### GET /user/:user_Id
Get balance and transaction history for a user. Returns: `{ "balance": 100, "transactions": [...] }`

### GET /accounts
Get balances of all clients. Returns: `{ "balances": { "user1": 100, ... } }`

### GET /stats
Get timing statistics (logging vs counter service call times)

### POST /stats/reset
Reset timing statistics

## Manual Testing (curl)

```bash
# Add 100 to user1
curl -X POST http://localhost:3000/transaction -H "Content-Type: application/json" -d '{"user_Id":"user1","amount":100}'

# Withdraw 50 from user1
curl -X POST http://localhost:3000/transaction -H "Content-Type: application/json" -d '{"user_Id":"user1","amount":-50}'

# Get user balance and transactions
curl http://localhost:3000/user/user1

# Get all accounts
curl http://localhost:3000/accounts
```

## Performance Testing

```bash
cd performance-client
npm install
npm test          # Run both scenarios
npm run scenario1 # 10 clients × 10K tx each (own account) → 10 accounts @ 10K
npm run scenario2 # 10 clients × 10K tx each (same account) → 1 account @ 100K
```

## Local Development (without Docker)

```bash
# Terminal 1 - Logging service
cd logging-service && npm install && npm start

# Terminal 2 - Counter service
cd counter-service && npm install && npm start

# Terminal 3 - Facade service
cd facade-service && npm install && npm start
```
# microservices-kpi
