#!/bin/bash
# import-alerts.sh — Import SigNoz alert rules after authenticating
# Usage: bash import-alerts.sh <SIGNOZ_SESSION_TOKEN>
# Get the token by logging into SigNoz UI at http://localhost:3301 and
# extracting the JWT from browser DevTools > Application > Cookies > session_token

set -e

SIGNOZ_URL="http://localhost:3301"
TOKEN="${1:-}"

if [ -z "$TOKEN" ]; then
  echo "Usage: bash import-alerts.sh <session_token>"
  echo ""
  echo "Steps to get token:"
  echo "  1. Open http://localhost:3301"
  echo "  2. Log in (default: admin / admin)"
  echo "  3. Open DevTools > Application > Cookies"
  echo "  4. Copy the 'session_token' value"
  echo "  5. Run: bash import-alerts.sh <session_token>"
  exit 1
fi

echo "Importing chess engine alert rules..."

for rule_file in dashboards/alerts.json; do
  echo "Reading rules from $rule_file..."
  
  # Extract each rule and POST it
  rules_count=$(python3 -c "import json; d=json.load(open('$rule_file')); print(len(d['rules']))")
  
  for i in $(seq 0 $((rules_count - 1))); do
    rule_json=$(python3 -c "
import json, sys
d = json.load(open('$rule_file'))
rule = d['rules'][$i]
# SigNoz expects specific fields
payload = {
    'rule': rule,
    'version': d.get('version', 'v3.0.0')
}
print(json.dumps(payload))
")
    
    rule_name=$(python3 -c "import json; d=json.load(open('$rule_file')); print(d['rules'][$i]['name'])")
    echo "  Creating: $rule_name..."
    
    curl -s -X POST "$SIGNOZ_URL/api/v3/alerts" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "$rule_json" | python3 -c "import sys,json; r=json.load(sys.stdin); print('    Result:', r.get('status', r))" 2>/dev/null || echo "    (may need manual import)"
  done
done

echo ""
echo "Done! Check SigNoz UI > Alerts tab to verify."
echo "Alternative: Import dashboards/alerts.json via SigNoz UI > Alerts > Create Alert Rule > Import"
