#!/usr/bin/env bash
# Installs the packed tarball the way a consumer would and drives every entry
# point the README documents.
#
# 0.6.0 shipped a `bin` that exited 0 having printed nothing, and nothing caught
# it: `npm test` and `npm run generate:example` both invoke the generator by
# path, which is the one way that never crosses the symlink npm installs a bin
# as. Package managers disagree about how a bin is linked, and the disagreement
# is exactly what broke — so the check runs under each of them:
#
#   npm      symlink into node_modules/.bin
#   pnpm     generated shell shim, not a symlink
#   yarn     symlink, like npm
#   yarn-pnp no node_modules at all; resolution through a loader
#   bun      its own linker
#
# Usage: smoke-packed-artifact.sh [npm|pnpm|yarn|yarn-pnp|bun]
set -euo pipefail

pm="${1:-npm}"

work="$(mktemp -d)"
npm pack --silent --pack-destination "$work" >/dev/null
tarball="$(ls "$work"/*.tgz)"

cd "$work"
printf '{\n  "name": "smoke",\n  "version": "1.0.0",\n  "private": true\n}\n' > package.json

# How to install, how to reach the bin, and how to run node with the package
# resolvable. Only yarn-pnp needs its own answers to the last two.
node_run=(node)
case "$pm" in
  npm)      install=(npm install --silent "$tarball");              bin=(./node_modules/.bin/open-predicate-generate) ;;
  pnpm)     install=(pnpm add "$tarball");                          bin=(./node_modules/.bin/open-predicate-generate) ;;
  yarn)     install=(yarn add "file:$tarball");                     bin=(./node_modules/.bin/open-predicate-generate) ;;
  bun)      install=(bun add "$tarball");                           bin=(./node_modules/.bin/open-predicate-generate) ;;
  yarn-pnp)
    # Berry quarantines recently published versions from the registry, but this
    # installs a local file, so the age gate never applies.
    printf 'nodeLinker: pnp\n' > .yarnrc.yml
    # Berry insists on name@file:… where classic accepts a bare file: path.
    install=(yarn add "@open-predicate/open-predicate@file:$tarball")
    bin=(yarn run open-predicate-generate)
    node_run=(yarn node)
    ;;
  *) echo "::error::unknown package manager '$pm'"; exit 2 ;;
esac

"${install[@]}" >/dev/null 2>&1 || { echo "::error::$pm could not install the tarball"; "${install[@]}"; exit 1; }

fail() { echo "::error::[$pm] $1"; exit 1; }

# 1. The bin, reached the way this package manager links it. This is the case
#    that regressed, and the only check that would have caught it.
out="$("${bin[@]}" --help 2>/dev/null || true)"
case "$out" in
  *"derive a per-resource filter schema"*) ;;
  *) fail "the installed bin produced no usable output" ;;
esac

# 2. It must still not run merely because it was imported, which is what the
#    entry guard exists for in the first place.
quiet="$("${node_run[@]}" --input-type=module -e 'await import("@open-predicate/open-predicate/generate");' 2>/dev/null || true)"
[ -z "$quiet" ] || fail "importing the generator ran it"

# 3. The three consumption paths the README documents.
"${node_run[@]}" -e 'const s=require("@open-predicate/open-predicate"); if(!s.$id) throw new Error("no $id")' \
  >/dev/null 2>&1 || fail "require() did not yield the schema"
"${node_run[@]}" --input-type=module -e 'import s from "@open-predicate/open-predicate" with { type: "json" }; if(!s.$id) throw new Error("no $id")' \
  >/dev/null 2>&1 || fail "the documented ESM import attribute did not yield the schema"
"${node_run[@]}" --input-type=module -e 'import * as g from "@open-predicate/open-predicate/generate"; if (typeof g.generateFilterSchema !== "function") throw new Error("missing export")' \
  >/dev/null 2>&1 || fail "./generate does not export generateFilterSchema"

echo "[$pm] packed artifact OK — bin, import attribute and ./generate all work"
