## What this changes, and why

<!-- What it does to the project, not which files were edited. Link the issue or decision record. -->

## Class of change

See the table in [`GOVERNANCE.md`](../GOVERNANCE.md). If it is unclear which applies, it is normative.

- [ ] **Editorial** — cannot change what a conforming implementation does
- [ ] **Substantive, compatible** — new optional behaviour; references an issue
- [ ] **Normative** — changes what `MUST` happen, adds/removes/renames an operator, or changes
      semantics, coercion, error conditions or the safety limits

## If normative

- [ ] A decision record under [`decisions/`](../decisions) is merged, or is part of this PR
- [ ] `CHANGELOG.md` entry with a **migration note** for anything breaking
- [ ] The schema `$id` version is bumped if the grammar moved, and the old `$id` is left untouched —
      published `$id`s are immutable (SPEC.md §9)
- [ ] `SPEC.md`, the schema's own operator `description`s, and the README operator table all agree.
      Six contradicting descriptions were a real defect once; see `decisions/0001`
- [ ] The dissent of anyone who objected is recorded in the decision record, not discarded

## Checks

- [ ] `npm test` passes locally (132 tests)
- [ ] New or changed operators have at least one fixture in `tests/fixtures/` — a test asserts every
      operator in the grammar is exercised, so the operator table and the fixture set stay the same list
- [ ] `x-profiles` still covers exactly the operators the grammar defines
- [ ] If the generator changed, its committed output under `examples/` is regenerated — a test checks
      for drift
- [ ] No new runtime dependencies. `ajv` and `ajv-formats` as dev-dependencies are the whole toolchain,
      and keeping it that way is deliberate

## Serving and release

- [ ] If this moves the grammar version, the site needs `node sync.mjs <tag>` after release so the new
      `$id` resolves — see [`RELEASING.md`](../RELEASING.md#serving-the-schema-from-its-id). A tag alone
      does not finish a release
