#!/usr/bin/env bash
# Builds reviewable artifacts only. Does not migrate a database or restart services.
set -euo pipefail
if [[ ! -v NODE_OPTIONS ]]; then export NODE_OPTIONS=--max-old-space-size=1024; fi
backend_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
frontend_dir=${VOEX_FRONTEND_DIR:-"$(dirname "$backend_dir")/web"}
output_dir=${1:-"$backend_dir/dist/collaboration-$(date +%Y%m%d-%H%M%S)"}
if [[ ! -f "$frontend_dir/package.json" || ! -f "$backend_dir/collab/package.json" ]]; then
  printf '%s\n' 'Frontend or collaborative service source is missing.' >&2
  exit 1
fi
if [[ -e "$output_dir" ]]; then
  printf '%s\n' 'Output path already exists; choose a new path.' >&2
  exit 1
fi
mkdir -p -- "$output_dir"
output_dir=$(cd -- "$output_dir" && pwd)
pnpm --dir "$frontend_dir" install --frozen-lockfile
pnpm --dir "$frontend_dir" run type-check
pnpm --dir "$frontend_dir" exec vite build --outDir "$output_dir/frontend"
pnpm --dir "$backend_dir/collab" install --frozen-lockfile
pnpm --dir "$backend_dir/collab" run type-check
VOEX_COLLAB_SCHEMA_SOURCE="$frontend_dir/packages/editor-schema/src/index.ts" \
  pnpm --dir "$backend_dir/collab" run build
(cd -- "$backend_dir" && go build -mod=readonly -trimpath -o "$output_dir/voex-server" ./cmd/voex-server)
mkdir -p -- "$output_dir/collab" "$output_dir/database" "$output_dir/deploy/collaboration"
cp -a -- "$backend_dir/collab/dist" "$output_dir/collab/"
printf '%s\n' '{"type":"module","private":true}' > "$output_dir/collab/package.json"
cp -- "$backend_dir/internal/database/collaboration.sql" "$backend_dir/internal/database/schema.sql" "$output_dir/database/"
cp -- "$backend_dir/deploy/collaboration/"*.example "$output_dir/deploy/collaboration/"
cp -- "$backend_dir/deploy/collaboration/ecosystem.config.cjs" "$backend_dir/deploy/collaboration/drain.mjs" "$output_dir/deploy/collaboration/"
cp -- "$backend_dir/docs/COLLABORATION.md" "$backend_dir/docs/COLLABORATION-VALIDATION.md" "$output_dir/"
(cd -- "$output_dir" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
printf 'Built artifacts: %s\n' "$output_dir"
