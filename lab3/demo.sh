set -euo pipefail
BASE="${FACADE_URL:-http://localhost:13000}"
USER_ID="${DEMO_USER_ID:-lab3user}"

echo "POST 10 transactions to ${BASE} (user_Id=${USER_ID})"
for i in $(seq 1 10); do
  curl -sS -X POST "${BASE}/transaction" \
    -H "Content-Type: application/json" \
    -d "{\"user_Id\":\"${USER_ID}\",\"amount\":1,\"msg\":\"msg${i}\"}"
  echo ""
done

echo ""
echo "GET /user/${USER_ID}"
curl -sS "${BASE}/user/${USER_ID}"
echo ""
