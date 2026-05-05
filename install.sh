#!/usr/bin/env bash
set -euo pipefail

REPO="FlorianBruniaux/ctxharness"
INSTALL_DIR="${CTXHARNESS_INSTALL:-/usr/local/bin}"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64)        ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

case "$OS" in
  linux|darwin) ;;
  *)
    echo "Unsupported OS: $OS — on Windows download from: https://github.com/${REPO}/releases/latest" >&2
    exit 1
    ;;
esac

TARGET="${OS}-${ARCH}"
VERSION=$(curl -sf "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep '"tag_name"' | cut -d'"' -f4)

if [ -z "$VERSION" ]; then
  echo "Could not determine latest version. Check https://github.com/${REPO}/releases" >&2
  exit 1
fi

URL="https://github.com/${REPO}/releases/download/${VERSION}/ctxharness-${TARGET}"

echo "Installing ctxharness ${VERSION} for ${TARGET} → ${INSTALL_DIR}/ctxharness"
curl -fL "$URL" -o /tmp/ctxharness-download
chmod +x /tmp/ctxharness-download
mv /tmp/ctxharness-download "${INSTALL_DIR}/ctxharness"

echo "Done."
ctxharness --version
