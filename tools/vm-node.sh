#!/usr/bin/env bash
# Run a pnpm command for the JS workspace inside the Claude Linux VM.
# node_modules must NOT live in the Windows-mounted repo (Linux symlinks/binaries), so the code is
# mirrored to $HOME/jime_build, installed there, and pnpm-lock.yaml is copied back.
# Usage: bash tools/vm-node.sh test | bash tools/vm-node.sh packs:validate | bash tools/vm-node.sh exec <cmd...>
set -euo pipefail
SRC="${JIME_ROOT:-$HOME/mnt/JiME_Claude}"
BUILD="$HOME/jime_build"
export JIME_WORK="${JIME_WORK:-$SRC/data}"
export PATH="$HOME/.npm-global/bin:$PATH"
command -v pnpm >/dev/null || npm install -g --prefix "$HOME/.npm-global" pnpm@10.34.7 >/dev/null
mkdir -p "$BUILD"
rsync -a --delete --exclude node_modules --exclude .git --exclude data --exclude 'Декомпилированые файлы' \
  --exclude jime_data.zip --exclude prototype_3d --exclude target --exclude dist "$SRC/" "$BUILD/"
cd "$BUILD"
pnpm install --prefer-offline --reporter=silent
cmp -s pnpm-lock.yaml "$SRC/pnpm-lock.yaml" || cp pnpm-lock.yaml "$SRC/pnpm-lock.yaml"
if [ "${1:-}" = "exec" ]; then shift; "$@"; else pnpm run "$@"; fi
