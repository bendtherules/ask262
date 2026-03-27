#!/usr/bin/env bash
# Add the engine262 repository as a git subtree (squashed)
# Usage: ./setup/init_engine262.sh
# This will add the repository at ./engine262 using a squashed subtree

set -euo pipefail

REPO_URL="https://github.com/bendtherules/engine262"
REPO_ROOT=$(git rev-parse --show-toplevel)
TARGET_DIR="${REPO_ROOT}/engine262"

# Add the repository as a git subtree (squashed)
# If the target directory already exists, assume the subtree is present.
if [ ! -d "$TARGET_DIR" ]; then
  git -C "${REPO_ROOT}" subtree add --prefix=engine262 "$REPO_URL" main --squash
else
  echo "Subtree already present at $TARGET_DIR"
fi

echo "Subtree added and initialized at ./$TARGET_DIR"
