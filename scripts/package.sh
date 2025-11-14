#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm ci
npm run build
TS="$(date +%Y%m%d%H%M%S)"
OUT_DIR="$ROOT/release"
PKG_DIR="$OUT_DIR/beershuffle-$TS"
mkdir -p "$PKG_DIR"
mkdir -p "$PKG_DIR/dist" "$PKG_DIR/server" "$PKG_DIR/public" "$PKG_DIR/scripts"
cp -R "$ROOT/dist/" "$PKG_DIR/dist/"
cp -R "$ROOT/server/" "$PKG_DIR/server/"
cp -R "$ROOT/public/" "$PKG_DIR/public/"
cp "$ROOT/package.json" "$PKG_DIR/"
cp "$ROOT/package-lock.json" "$PKG_DIR/"
cp "$ROOT/README.md" "$PKG_DIR/"
tar -czf "$OUT_DIR/beershuffle-$TS.tar.gz" -C "$OUT_DIR" "beershuffle-$TS"
echo "$OUT_DIR/beershuffle-$TS.tar.gz"
