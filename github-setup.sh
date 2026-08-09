#!/usr/bin/env bash
# Initialize the local repo and push all files to GitHub using the GitHub CLI.
# Requires: git and gh (https://cli.github.com)
set -euo pipefail

REPO="OlinaAI/OlinaAI"

cd "$(dirname "$0")"

git init -b main
git add -A
git commit -m "Initial commit: OlinaAI electron app"
git branch -M main
git remote add origin "https://github.com/${REPO}.git"

if command -v gh >/dev/null 2>&1; then
  gh repo create "$REPO" --private --confirm 2>/dev/null || true
  gh repo view "$REPO" >/dev/null 2>&1 || gh repo create "$REPO" --confirm
fi

git push -u origin main

echo "Done. Pushed all files to https://github.com/${REPO}"
