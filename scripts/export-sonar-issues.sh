#!/usr/bin/env bash
# Exports open SonarCloud issues for this project as CSV and as
# ticket-ready markdown (one section per issue), grouped by severity.
#
# Usage:
#   SONAR_TOKEN=<your token> ./scripts/export-sonar-issues.sh
#

set -euo pipefail

: "${SONAR_TOKEN:?Set SONAR_TOKEN in your environment first}"

ORG="mohamedisa"
PROJECT_KEY="MohamedIsa_SpecForgeAI"
OUT_DIR="./sonar-export"
mkdir -p "$OUT_DIR"

PAGE_SIZE=500
PAGE=1
ALL_ISSUES="[]"

while :; do
  RESPONSE=$(curl -s -u "${SONAR_TOKEN}:" \
    "https://sonarcloud.io/api/issues/search?organization=${ORG}&componentKeys=${PROJECT_KEY}&resolved=false&ps=${PAGE_SIZE}&p=${PAGE}")

  TOTAL=$(echo "$RESPONSE" | jq '.total')
  ISSUES=$(echo "$RESPONSE" | jq '.issues')
  ALL_ISSUES=$(jq -s '.[0] + .[1]' <(echo "$ALL_ISSUES") <(echo "$ISSUES"))

  FETCHED=$(echo "$ALL_ISSUES" | jq 'length')
  if [ "$FETCHED" -ge "$TOTAL" ]; then
    break
  fi
  PAGE=$((PAGE + 1))
done

echo "$ALL_ISSUES" > "$OUT_DIR/issues.json"

# CSV: severity,type,rule,component,line,message
echo "$ALL_ISSUES" | jq -r '
  ["severity","type","rule","component","line","message"],
  (.[] | [.severity, .type, .rule, .component, (.line // ""), .message])
  | @csv' > "$OUT_DIR/issues.csv"

# Ticket-ready markdown, grouped by severity (BLOCKER/CRITICAL first)
{
  echo "# SonarCloud issues — ${PROJECT_KEY}"
  echo
  for SEV in BLOCKER CRITICAL MAJOR MINOR INFO; do
    COUNT=$(echo "$ALL_ISSUES" | jq --arg s "$SEV" '[.[] | select(.severity == $s)] | length')
    [ "$COUNT" -eq 0 ] && continue
    echo "## $SEV ($COUNT)"
    echo
    echo "$ALL_ISSUES" | jq -r --arg s "$SEV" '
      .[] | select(.severity == $s) |
      "- **[\(.type)]** \(.component | sub(".*:"; "")):\(.line // "?") — \(.message) _(rule: \(.rule))_"'
    echo
  done
} > "$OUT_DIR/issues.md"

echo "Wrote $OUT_DIR/issues.json, issues.csv, issues.md ($(echo "$ALL_ISSUES" | jq 'length') issues total)"
