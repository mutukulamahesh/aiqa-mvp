#!/usr/bin/env bash
# EPIC-02 DoD gate — parallel isolation stress test
# Runs the same test 10x with 4 workers.
# Pass = zero failures, zero mixed output blocks.
set -euo pipefail

STRESS_DIR=$(mktemp -d)
trap "rm -rf $STRESS_DIR" EXIT

WORKERS=${1:-4}
REPEAT=${2:-10}
TEST_FILE=${3:-tests/example.yaml}

echo ""
echo "🔥 AIQA Parallel Stress Test"
echo "   Source : $TEST_FILE"
echo "   Copies : $REPEAT"
echo "   Workers: $WORKERS"
echo ""

for i in $(seq 1 $REPEAT); do
  cp "$TEST_FILE" "$STRESS_DIR/test-$(printf '%02d' $i).yaml"
done

npx ts-node src/cli.ts --env dev run-all "$STRESS_DIR" --workers "$WORKERS" --headless

echo ""
echo "✅ Stress test complete — check above for interleaved output or unexpected failures"
