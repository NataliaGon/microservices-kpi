#!/bin/bash
set -e
FACADE="${FACADE_URL:-http://localhost:3000}"
CONSUL="${CONSUL_URL:-http://localhost:8500}"

echo "=== Lab 5 smoke test (Consul) ==="
echo "Waiting for facade..."
for i in $(seq 1 30); do
  if curl -sf "$FACADE/accounts" >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "Consul services:"
curl -s "$CONSUL/v1/agent/services"
echo ""
echo ""

echo "POST 10 transactions (msg1..msg10), user demo..."
for i in $(seq 1 10); do
  curl -sf -X POST "$FACADE/transaction" -H "Content-Type: application/json" -d "{\"user_Id\":\"demo\",\"amount\":$i,\"msg\":\"msg$i\"}"
  echo ""
done

sleep 2
echo ""
echo "GET /user/demo (expect 10 txs, balance 55):"
curl -s "$FACADE/user/demo"
echo ""
echo ""
echo "GET /accounts:"
curl -s "$FACADE/accounts"
echo ""
echo ""
echo "Done. Check logging logs for [logging-1]/[logging-2]/[logging-3] mix:"
echo "  docker compose logs logging-service-1 logging-service-2 logging-service-3"
