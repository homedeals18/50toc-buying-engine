#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTOMATION_DIR="$ROOT_DIR/automation/costco_business_center"
LOG_DIR="$ROOT_DIR/artifacts/costco_business_center/logs"
mkdir -p "$LOG_DIR" "$ROOT_DIR/artifacts/costco_business_center/screenshots"
LOG_FILE="$LOG_DIR/setup-$(date -u +%Y%m%dT%H%M%SZ).log"
exec > >(tee "$LOG_FILE") 2>&1
cd "$AUTOMATION_DIR"
echo "[setup] Installing Costco Business Center automation Node dependencies..."
npm install
echo "[setup] Installing Playwright Chromium and required system dependencies..."
npx playwright install --with-deps chromium
echo "[setup] Verifying Playwright launches successfully..."
node ./verify-playwright-launch.js
echo "[setup] Complete. Log saved to $LOG_FILE"
