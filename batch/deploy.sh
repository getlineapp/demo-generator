#!/bin/bash
# Deploy dist/{parentHash}/ to Zenbox under demo.getlineapp.com/{parentHash}/
# Does NOT touch the existing PHP demo at site root.
#
# Usage:
#   ./deploy.sh            # real deploy
#   ./deploy.sh --dry-run  # preview

set -euo pipefail

cd "$(dirname "$0")"

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required. Install with: brew install jq"
  exit 1
fi

PARENT_HASH=$(jq -r .parentHash config.json)
if [ "$PARENT_HASH" = "TBD" ] || [ -z "$PARENT_HASH" ] || [ "$PARENT_HASH" = "null" ]; then
  echo "ERROR: parentHash not set in config.json. Run: npm run init-hash"
  exit 1
fi

HOST=$(jq -r '.deploy.host // "s37.zenbox.pl"' config.json)
USER=$(jq -r '.deploy.user // "pnut"' config.json)
BASE_PATH=$(jq -r '.deploy.base_path // "~/domains/demo.getlineapp.com/public_html"' config.json)

SRC="dist/${PARENT_HASH}/"
DEST="${USER}@${HOST}:${BASE_PATH}/${PARENT_HASH}/"

if [ ! -d "$SRC" ]; then
  echo "ERROR: $SRC does not exist. Run: npm run build"
  exit 1
fi

DRY_RUN=""
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
  echo "=== DRY RUN — no files will be uploaded ==="
fi

echo "Deploying:"
echo "  src:  $SRC"
echo "  dest: $DEST"
echo

# rsync with --delete only within {parentHash}/ — root stays untouched.
# Include dotfiles (.htaccess, .htpasswd) but exclude local noise.
rsync -avz --delete ${DRY_RUN} \
  --exclude ".DS_Store" \
  --exclude "Thumbs.db" \
  "${SRC}" "${DEST}"

if [ -z "$DRY_RUN" ]; then
  echo
  echo "Done. Verify:"
  echo "  Admin (protected): https://demo.getlineapp.com/${PARENT_HASH}/"
  echo "  Per-festival demo: https://demo.getlineapp.com/${PARENT_HASH}/malta-festival/"
  echo
  echo "Root PHP demo (untouched): https://demo.getlineapp.com/"
fi
