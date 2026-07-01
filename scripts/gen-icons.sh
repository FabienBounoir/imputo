#!/usr/bin/env bash
# Génère les icônes PNG de la PWA depuis les SVG sources (static/*.svg).
# Dépend de rsvg-convert (librsvg). Idempotent : ré-exécutable à volonté.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC=static
OUT=static/icons
mkdir -p "$OUT"

command -v rsvg-convert >/dev/null 2>&1 || { echo "rsvg-convert manquant (brew install librsvg)"; exit 1; }

# Icônes carrées (logo arrondi, fond transparent)
rsvg-convert -w 192 -h 192 "$SRC/logo.svg" -o "$OUT/icon-192.png"
rsvg-convert -w 512 -h 512 "$SRC/logo.svg" -o "$OUT/icon-512.png"
rsvg-convert -w 32 -h 32 "$SRC/logo.svg" -o "$OUT/favicon-32.png"
rsvg-convert -w 16 -h 16 "$SRC/logo.svg" -o "$OUT/favicon-16.png"

# Maskable (fond vert plein, marge de sécurité) — sert aussi d'apple-touch (sans transparence)
rsvg-convert -w 512 -h 512 "$SRC/icon-maskable.svg" -o "$OUT/icon-maskable-512.png"
rsvg-convert -w 180 -h 180 "$SRC/icon-maskable.svg" -o "$OUT/apple-touch-icon.png"

# Image Open Graph (partage)
rsvg-convert -w 1200 -h 630 "$SRC/og.svg" -o "$SRC/og.png"

echo "Icônes générées dans $OUT et $SRC/og.png"
