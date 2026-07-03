#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTOMATION_DIR="$ROOT_DIR/automation/bjs"
LOG_DIR="$ROOT_DIR/artifacts/bjs/logs"
mkdir -p "$LOG_DIR" "$ROOT_DIR/artifacts/bjs/screenshots"
LOG_FILE="$LOG_DIR/setup-$(date -u +%Y%m%dT%H%M%SZ).log"

exec > >(tee "$LOG_FILE") 2>&1

echo "[setup] Installing BJ's automation Node dependencies..."
cd "$AUTOMATION_DIR"
npm install

echo "[setup] Installing Playwright Chromium and required system dependencies..."
npx playwright install --with-deps chromium

echo "[setup] Verifying Playwright launches successfully..."
node ./verify-playwright-launch.js

echo "[setup] Complete. Log saved to $LOG_FILE"
