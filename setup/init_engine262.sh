#!/usr/bin/env bash
# Shallow clone the engine262 repository as a git submodule
# Usage: ./add_engine_submodule.sh
# This will add the submodule at ./engine262 with a depth of 1 (shallow clone)

set -euo pipefail

REPO_URL="https://github.com/bendtherules/engine262"
TARGET_DIR="./engine262"

# Add the submodule with shallow clone
git submodule add --depth 1 "$REPO_URL" "$TARGET_DIR"

# Initialize and update the submodule (fetches the shallow copy)
git submodule update --init --depth 1 "$TARGET_DIR"

echo "Submodule added and initialized at ./$TARGET_DIR"
