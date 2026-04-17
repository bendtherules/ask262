#!/bin/bash
set -e

# Parse arguments
BUMP_VERSION="patch"  # Default to patch
while [[ $# -gt 0 ]]; do
  case $1 in
    --patch|--minor|--major)
      BUMP_VERSION="${1:2}"
      shift
      ;;
    --no-bump)
      BUMP_VERSION=""
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--patch|--minor|--major|--no-bump]"
      echo ""
      echo "Options:"
      echo "  --patch    Bump patch version (0.0.1 -> 0.0.2) [default]"
      echo "  --minor    Bump minor version (0.0.1 -> 0.1.0)"
      echo "  --major    Bump major version (0.0.1 -> 1.0.0)"
      echo "  --no-bump  Don't bump version, release as-is"
      echo "  -h, --help Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Run '$0 --help' for usage"
      exit 1
      ;;
  esac
done

echo "🔍 Checking for uncommitted git changes..."

# Check for uncommitted changes
if ! git diff --quiet HEAD || ! git diff --cached --quiet HEAD; then
  echo "❌ Error: You have uncommitted changes!"
  echo ""
  git status --short
  echo ""
  echo "Please commit or stash your changes before releasing."
  exit 1
fi

# Check for untracked files
UNTRACKED=$(git ls-files --others --exclude-standard)
if [ -n "$UNTRACKED" ]; then
  echo "⚠️ Warning: You have untracked files:"
  echo "$UNTRACKED"
  echo ""
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "✅ No uncommitted changes"

# Bump version if requested
if [ -n "$BUMP_VERSION" ]; then
  echo ""
  echo "📦 Bumping $BUMP_VERSION version..."
  npm version $BUMP_VERSION
  echo "✅ Version bumped and tagged"
fi

echo ""
echo "🔍 Checking for hard links..."

# Find files with hard links (link count > 1)
HARD_LINKS=$(find . -type f -links +1 \
  -not -path "./node_modules/*" \
  -not -path "./engine262/node_modules/*" \
  -not -path "./.opencode/node_modules/*" \
  -not -path "./.git/*" 2>/dev/null || true)

if [ -n "$HARD_LINKS" ]; then
  echo "⚠️ Found hard links, fixing..."
  echo "$HARD_LINKS"
  
  # Break hard links by copying
  echo "$HARD_LINKS" | while read -r file; do
    echo "  Fixing: $file"
    tmp="/tmp/fix-hardlink-$(basename "$file").$$"
    cp "$file" "$tmp"
    mv -f "$tmp" "$file"
  done
  
  echo "✅ Hard links fixed"
else
  echo "✅ No hard links found"
fi

echo ""
echo "📦 Running release checks..."
npm run prepublish

echo ""
echo "🚀 Publishing to npm..."
read -p "Are you sure you want to release? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  npm publish --access=public
  echo ""
  echo "✅ Released successfully!"
else
  echo "❌ Aborted."
  exit 1
fi
