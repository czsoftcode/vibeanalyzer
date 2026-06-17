#!/usr/bin/env bash
# Build and install vibeanalyzer into ~/.local/ using the same pattern as Claude Code.
#
# Layout after installation:
#   ~/.local/bin/vibeanalyzer                                → symlink
#   ~/.local/share/vibeanalyzer/versions/<version>/dist/...  → the package's own files
#   ~/.local/share/vibeanalyzer/versions/<version>/node_modules/  → production deps
#
# Older versions are kept around (rollback). Delete them manually if they get in the way.

set -euo pipefail

# Run from the package root regardless of where the script is called from.
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
INSTALL_DIR="$HOME/.local/share/vibeanalyzer/versions/$VERSION"
BIN_PATH="$HOME/.local/bin/vibeanalyzer"

echo "→ npm run build"
npm run build

echo "→ installing into $INSTALL_DIR"
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
mkdir -p "$HOME/.local/bin"

cp -r dist package.json "$INSTALL_DIR/"

echo "→ production npm install (runtime deps only)"
# --ignore-scripts: only dist/ + package.json are copied here, not scripts/, so any
# lifecycle hook in package.json would crash. vibeanalyzer currently has no runtime
# dependencies, so this step is effectively a no-op, but it keeps the install correct
# if production deps are added later.
(cd "$INSTALL_DIR" && npm install --omit=dev --no-audit --no-fund --silent --ignore-scripts)

chmod +x "$INSTALL_DIR/dist/bin.js"
ln -sfn "$INSTALL_DIR/dist/bin.js" "$BIN_PATH"

echo ""
echo "vibeanalyzer $VERSION installed."
echo "  binary: $BIN_PATH"
echo "  files:  $INSTALL_DIR"
echo ""
echo "Try:  vibeanalyzer --version"

# Upozornění, pokud ~/.local/bin není v PATH.
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *)
    echo ""
    echo "⚠  $HOME/.local/bin není v PATH. Přidej do ~/.bashrc:"
    echo "     export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac
