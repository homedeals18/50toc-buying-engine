#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTOMATION_DIR="$ROOT_DIR/automation/bjs"
LOG_DIR="$ROOT_DIR/artifacts/bjs/logs"
SCREENSHOT_DIR="$ROOT_DIR/artifacts/bjs/screenshots"
mkdir -p "$LOG_DIR" "$SCREENSHOT_DIR"
LOG_FILE="$LOG_DIR/blue-diamond-almonds-$(date -u +%Y%m%dT%H%M%SZ).log"

exec > >(tee "$LOG_FILE") 2>&1

cd "$AUTOMATION_DIR"
echo "[run] Verifying Playwright can launch Chromium..."
node ./verify-playwright-launch.js

echo "[run] Running BJ's Blue Diamond Almonds Playwright test..."
npm run test:blue-diamond

echo "[run] Complete. Log saved to $LOG_FILE"
echo "[run] Screenshots saved under $SCREENSHOT_DIR"
