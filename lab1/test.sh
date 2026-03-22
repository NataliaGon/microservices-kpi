#!/bin/bash
set -e
FACADE="${FACADE_URL:-http://localhost:3000}"
CURL_OPTS="-s --connect-timeout 5 --max-time 10"

echo "=== Lab1 API Test ==="
echo "Facade URL: $FACADE"
echo ""

echo "1. POST transaction (user1 +100)..."
RES=$(curl $CURL_OPTS -X POST "$FACADE/transaction" -H "Content-Type: application/json" -d '{"user_Id":"user1","amount":100}') || { echo "   FAIL: Connection refused or timeout. Is docker-compose up? Run: docker-compose ps"; exit 1; }
echo "   Response: $RES"
[[ "$RES" == *"balance"* ]] || { echo "   FAIL"; exit 1; }
echo "   OK"

echo "2. POST transaction (user1 -30)..."
RES=$(curl $CURL_OPTS -X POST "$FACADE/transaction" -H "Content-Type: application/json" -d '{"user_Id":"user1","amount":-30}')
echo "   Response: $RES"
echo "   OK"

echo "3. GET /user/user1..."
RES=$(curl $CURL_OPTS "$FACADE/user/user1")
echo "   Response: $RES"
[[ "$RES" == *"balance"* ]] && [[ "$RES" == *"transactions"* ]] || { echo "   FAIL"; exit 1; }
echo "   OK"

echo "4. GET /accounts..."
RES=$(curl $CURL_OPTS "$FACADE/accounts")
echo "   Response: $RES"
[[ "$RES" == *"user1"* ]] && [[ "$RES" == *"balance"* ]] || { echo "   FAIL"; exit 1; }
echo "   OK"

echo ""
echo "=== All tests passed ==="
