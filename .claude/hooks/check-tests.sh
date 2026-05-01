#!/bin/bash
# Stop hook: run unit tests and lint when source files have changed.
# Exits 1 to block Claude from finishing if checks fail.

set -euo pipefail

CHANGED=$(git status --porcelain 2>/dev/null | awk '{print $2}' | grep -E '^(src|e2e)/|^eslint\.config|^vitest\.config' || true)

if [ -z "$CHANGED" ]; then
  exit 0
fi

echo "Source files changed — running unit tests and lint..."

FAILED=0
npm run test:unit 2>&1 || FAILED=1
npm run lint 2>&1 || FAILED=1

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "ERROR: Tests or lint failed. Fix the failures before finishing."
  exit 1
fi

echo "All checks passed."
