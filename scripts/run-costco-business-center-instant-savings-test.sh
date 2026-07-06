#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTOMATION_DIR="$ROOT_DIR/automation/costco_business_center"
LOG_DIR="$ROOT_DIR/artifacts/costco_business_center/logs"
SCREENSHOT_DIR="$ROOT_DIR/artifacts/costco_business_center/screenshots"
mkdir -p "$LOG_DIR" "$SCREENSHOT_DIR"
LOG_FILE="$LOG_DIR/costco-business-center-instant-savings-$(date -u +%Y%m%dT%H%M%SZ).log"
exec > >(tee "$LOG_FILE") 2>&1
cd "$AUTOMATION_DIR"
echo "[run] Verifying Playwright can launch Chromium..."
node ./verify-playwright-launch.js
echo "[run] Running Costco Business Center Instant Savings shopping list intelligence scrape..."
npm run scrape:costco-business-center:instant-savings
echo "[run] Complete. Log saved to $LOG_FILE"
echo "[run] Screenshots saved under $SCREENSHOT_DIR"
