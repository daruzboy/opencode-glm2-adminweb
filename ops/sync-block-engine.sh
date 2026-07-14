#!/usr/bin/env bash
# Sinkronkan vendored engine Mobirise dari editor-web (sumber kebenaran) ke glm2.
#
# Kenapa vendored: CI glm2 & Docker build tak bisa melihat repo editor-web (privat,
# terpisah). Salinan ber-stempel SHA + test yang ikut jalan di CI = drift terdeteksi
# saat sync, bukan di produksi. Lihat packages/engine-mobirise/VENDORED.md.
#
# Pakai: ops/sync-block-engine.sh [path-editor-web]   (default: ../editor-web)

set -euo pipefail

GLM2_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_REPO="${1:-$GLM2_DIR/../editor-web}"
SRC_DIR="$SRC_REPO/packages/block-engine/src"
DST_DIR="$GLM2_DIR/packages/engine-mobirise/src"
VENDORED_MD="$GLM2_DIR/packages/engine-mobirise/VENDORED.md"

[ -d "$SRC_DIR" ] || { echo "FATAL: $SRC_DIR tidak ada"; exit 1; }

SHA=$(git -C "$SRC_REPO" rev-parse HEAD)
DIRTY=$(git -C "$SRC_REPO" status --porcelain -- packages/block-engine/src | wc -l)
if [ "$DIRTY" -gt 0 ]; then
  echo "PERINGATAN: block-engine di editor-web punya perubahan belum di-commit —"
  echo "SHA yang distempel tidak mewakili isi sebenarnya. Commit dulu di editor-web."
  exit 1
fi

rsync -a --delete "$SRC_DIR/" "$DST_DIR/"
sed -i "s/commit \`[0-9a-f]\{40\}\`/commit \`$SHA\`/" "$VENDORED_MD"
sed -i "s/^- \*\*Disinkron:\*\* .*/- **Disinkron:** $(date +%F)/" "$VENDORED_MD"

echo "Tersinkron dari $SHA — menjalankan build + test vendored..."
cd "$GLM2_DIR"
pnpm --filter @digimaestro/engine-mobirise build
pnpm --filter @digimaestro/engine-mobirise test
echo "OK. Commit packages/engine-mobirise/ untuk mengunci sync ini."
