#!/usr/bin/env bash

# Script to run tests with correct Node.js runtime
# Works around Bun's node shim on macOS while supporting standard node on CI

if [ -f "/opt/homebrew/bin/node" ]; then
  # macOS with Homebrew Node.js - use explicit path
  /opt/homebrew/bin/node node_modules/.bin/vitest "$@"
else
  # CI or other environments - use standard node
  node node_modules/.bin/vitest "$@"
fi
