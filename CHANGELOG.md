# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) — with the pre-1.0 caveat that a
minor release may break compatibility, in which case the break is spelled out below.

## [Unreleased]

## [0.6.2] — 2026-09-14

**A packaging release, again.** The schema is still byte-identical and the `$id` still names
`v0.4.0`. 0.6.1 fixed the defects an audit of the package found; this one fixes the ones that
audit had not looked for, and closes the coverage gaps that let the first set through.

### Fixed

- **35 links in the shipped documents pointed at files that are not shipped.** The package is a
  subset of the repository, so a relative link into `examples/` reads fine on GitHub and is dead for anyone
  reading the same file in `node_modules`. npmjs.com hides this for the README — it rewrites relative
  links against the repository — but only for the README, and only on that page.

  Fixed from both ends. `files` now ships the documents a consumer or a would-be contributor
  plausibly wants offline: `COMPARISON.md`, `CONTRIBUTING.md`, `GOVERNANCE.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md` and `SUPPORT.md`. Links to things a schema package has no business shipping —
  `examples/`, `assets/`, `.github/`, `tests/`, `experiments/`, the 39 KB decision record and the
  maintainer-only `RELEASING.md` — are now absolute. The tarball grew from 61 KB to 77 KB, which is
  the price of the docs being readable where they are installed.

- **`npx open-predicate` printed npm's `could not determine executable to run`.** The unscoped name
  is a deprecated placeholder with no code, so npm had no bin to run and said so in its own terms,
  which tells someone following a stale instruction nothing. It now carries a single executable
  whose only job is to name the scoped package and exit non-zero. The recipe in
  [`RELEASING.md`](https://github.com/OpenPredicate/open-predicate/blob/main/RELEASING.md) is updated
  to reproduce it, and records that `npm deprecate` marks a version rather than a package, so the
  deprecation has to be re-applied after each publish.

### Added

- **The packed artifact is now tested under every package manager, on every platform that links a
  bin differently.** The 0.6.0 no-op was a symlink bug, and package managers disagree about
  symlinks: npm and yarn classic symlink, pnpm writes a shell shim, Yarn Berry's PnP has no
  `node_modules` at all, and Windows gets `.cmd` wrappers that pass the real path — which is why the
  bug never existed there. The release gate added in 0.6.1 only ever proved the npm-on-Linux case.

  [`.github/scripts/smoke-packed-artifact.sh`](https://github.com/OpenPredicate/open-predicate/blob/main/.github/scripts/smoke-packed-artifact.sh)
  installs the tarball and drives the bin, `require()`, the documented ESM import attribute and
  `./generate` under a named package manager, and CI runs it across npm, pnpm, yarn, yarn-pnp and
  bun on Linux plus npm on Windows and macOS. The release workflow calls the same script rather than
  keeping a second copy of the logic.

- **`tests/packaging.test.mjs` asserts the claims a tarball can break.** Every relative link in a
  shipped document resolves to a shipped file; no shipped document links outside the package; the
  bin is shipped, non-empty and still has its shebang; and the declared Node floor is the one the
  code actually needs. It reads the file list from `npm pack --dry-run --json` rather than
  extracting a tarball, so it needs no `tar` and runs on Windows unchanged.

- **CI declares `permissions: contents: read`.** It had no `permissions` block at all, so it
  inherited the repository default while `release.yml` had been careful to take none.

## [0.6.1] — 2026-09-14

**A packaging release.** No change to the grammar, the schema or the semantics of evaluation:
`open-predicate-schema.json` is byte-identical to 0.6.0, and the `$id` still names `v0.4.0`. What
changed is that the package now works the way 0.6.0 said it did.

### Fixed

- **The CLI did nothing when invoked as a CLI.** `tools/generate-filter-schema.mjs` guarded its entry
  point with `fileURLToPath(import.meta.url) === process.argv[1]`, and npm installs a `bin` as a
  **symlink** — so `argv[1]` was `node_modules/.bin/open-predicate-generate` while `import.meta.url`
  was the file it pointed at. The comparison was false, `main()` never ran, and the process exited
  **0 having printed nothing**. Every `npx @open-predicate/open-predicate` and every global install
  was affected in `0.6.0`, the first release to ship a `bin` at all.

  It went unnoticed because the two ways it is exercised here both avoid the symlink:
  `npm run generate:example` and the tests call the file by path. The same comparison also failed for
  a plain path invocation anywhere under a symlinked directory — including `/tmp` on macOS, which is
  a symlink to `/private/tmp`.

  The guard now compares through `realpathSync` on both sides, and `tests/generator.test.mjs` runs
  the real generator through a real symlink and requires output, so the regression cannot return. It
  still must not run on import, and that is asserted in the same test.

- **`engines` was missing, so an unsupported Node failed obscurely.** The package now declares
  `"node": ">=20.10.0"`. That is the real floor, not a guess: the generator uses `parseArgs` from
  `node:util`, and the consumption path the README documents —
  `import schema from '@open-predicate/open-predicate' with { type: 'json' }` — needs import
  attributes, which is 20.10. Without the field, npm had nothing to warn against and a user on an
  older line got a stack trace instead of a version complaint.

- **The release pipeline never exercised the artifact it publishes.** `npm test` and
  `npm run generate:example` both invoke the generator by path, which is the one way that never
  crosses the symlink npm installs a `bin` as — so the no-op above passed every check and shipped.
  [`.github/workflows/release.yml`](https://github.com/OpenPredicate/open-predicate/blob/main/.github/workflows/release.yml) now packs the tarball, installs
  it into a scratch project the way a consumer would, and drives every entry point the README
  documents: the bin through its symlink, `require()`, the ESM import attribute, and
  `./generate`. It also asserts the generator stays silent when merely imported. A release cannot
  now ship an artifact whose documented entry points do not work.

### Changed

- **The npm package is scoped: `@open-predicate/open-predicate`.** 0.6.0 named it `open-predicate`,
  unscoped; it now sits under the `open-predicate` organisation on npmjs.com, which is where the
  project's packages will live. Nothing was ever published under the unscoped name, so there is no
  version to migrate from and no redirect to leave behind. GitHub Packages is unaffected — it still
  carries `@openpredicate/open-predicate`, because that scope has to match the repository owner.

  One consequence worth knowing: `npx` resolves a *package* name, so the generator is now
  `npx @open-predicate/open-predicate` rather than `npx open-predicate-generate`. The `bin` is
  still named `open-predicate-generate` once the package is installed.

  The unscoped `open-predicate` is claimed anyway, as a deprecated placeholder holding two files
  and no code, so the name cannot end up on something unrelated to the project.
  `npm install open-predicate` prints a redirect to the scoped package. It is not versioned
  alongside releases and the release pipeline never touches it — see
  [`RELEASING.md`](https://github.com/OpenPredicate/open-predicate/blob/main/RELEASING.md#the-reserved-unscoped-name).

### Added

- **GitHub Packages has its first copy.** `@openpredicate/open-predicate@0.6.1` is the first version
  to reach it; npmjs.com had been the only registry carrying anything. Installing from it still needs
  an `.npmrc` and a token even though it is public, so npmjs.com remains the easier path.

- **0.6.1 is the first release with provenance.** Published over OIDC from the workflow rather than
  from a laptop, so the tarball carries a SLSA v1 attestation linking it to the run and commit that
  built it. Verify with `npm view @open-predicate/open-predicate@0.6.1 dist.attestations`.

- **The project has a written governance and contribution process.**
  [`GOVERNANCE.md`](./GOVERNANCE.md) states how a decision is made and what it costs — editorial,
  substantive-compatible, or normative, where normative requires a record under
  [`decisions/`](https://github.com/OpenPredicate/open-predicate/tree/main/decisions), a migration note and a `$id` bump. It sets out how a disputed design
  call is resolved (answered in writing, then a decision record quoting the objection in the
  objector's words, then 14-day lazy consensus, then the editor decides **and the dissent is recorded
  in the record**), what earns commit rights, and an explicit royalty-free patent posture — MIT
  settles copyright and says nothing about patents, which is the first thing an adopter's lawyer
  looks for. It also states that there is currently one maintainer and calls that a defect rather
  than a design.

  [`CONTRIBUTING.md`](./CONTRIBUTING.md) leads with the thing the README already says is most useful
  — *disagreement* — and makes the three entry points concrete: file a design objection, build an
  implementation, or claim conformance for a library that already exists. It is candid that
  `tests/fixtures/` checks schema well-formedness only, has no records or expected results, uses an
  ajv-flavoured `expectKeyword`, and is excluded from the published package; and it names promoting
  `experiments/filter-to-sql/cases.mjs` (73 cases over 10 records, already shaped
  `{group, id, title, filter, expect}`) into a portable conformance suite as the highest-value
  contribution currently available.

  Also added: [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md), which makes explicit that blunt technical
  disagreement is welcome and is not incivility, and discloses that a report about the sole
  maintainer has nowhere independent to go inside the project;
  [`SECURITY.md`](./SECURITY.md), which defines what a vulnerability even means for a specification
  — a rule that makes conforming implementations unsafe, a filter that stays inside the §7 limits and
  is still superlinear, or any path where a predicate ends up dropped, widened or truncated, since
  that is an authorization bypass wherever filters carry tenancy; [`SUPPORT.md`](./SUPPORT.md); three
  issue forms; and a pull-request template whose checklist is tied to the invariants the tests
  already enforce. Discussions and private vulnerability reporting are enabled on the repository.

- **The schema is served from its `$id`.**
  `https://openpredicate.tech/schema/v0.4.0/open-predicate-schema.json` now returns the file it
  identifies, as `application/schema+json`, with `Access-Control-Allow-Origin: *` so browser-based
  tooling can fetch it and `Cache-Control: public,max-age=31536000,immutable` because a versioned
  `$id` never changes (§9). The served bytes are identical to
  [`open-predicate-schema.json`](./open-predicate-schema.json) in this repository.

  This closes what the README called the one piece of remaining work. The `$ref`-by-URL workflow
  that [Using it from OpenAPI](./README.md#using-it-from-openapi) and the capability document
  examples are written around now describes today rather than an intended end state, and the five
  RFC 9457 problem types under `https://openpredicate.tech/problems/` dereference as well. There is
  deliberately **no** unversioned or `latest` schema URL; both 404.

  Serving it is a second repository's job, so a release is not finished when the tag is pushed —
  [`OpenPredicate/openpredicate.tech`](https://github.com/OpenPredicate/openpredicate.tech) vendors
  the artefacts and has to be synced at the tag. That step is now written down in
  [`RELEASING.md`](https://github.com/OpenPredicate/open-predicate/blob/main/RELEASING.md#serving-the-schema-from-its-id).

- **Publishing is back on, and npmjs.com authenticates by OIDC.**
  [`.github/workflows/release.yml`](https://github.com/OpenPredicate/open-predicate/blob/main/.github/workflows/release.yml) publishes to both registries
  when a GitHub Release is published. The npmjs job uses npm's [trusted
  publishing](https://docs.npmjs.com/trusted-publishers): it requests `id-token: write` and npm
  exchanges that for a short-lived credential, so there is **no `NPM_TOKEN` secret** in this
  repository and nothing to rotate. Provenance is attached automatically, linking each tarball to
  the workflow run and commit that built it — though only for tarballs the workflow publishes, so
  0.6.0 has none: its bootstrap publish came from a laptop, which is the one publish OIDC cannot
  do. 0.6.1 is the first over OIDC. GitHub Packages stays token-authenticated — it has no
  OIDC equivalent — but `GITHUB_TOKEN` is minted per run and expires with it.

  `.github/scripts/version-published.sh` is restored alongside, so each job skips a version it has
  already published and a partially-failed release can be re-run safely.

  **The trust is pinned to the repository and to the workflow filename.** Renaming `release.yml`
  breaks publishing until the trusted publisher is updated to match.

  **npm cannot mint a package's first version over OIDC**, because a trusted publisher can only be
  attached to a package that already exists. Claiming `@open-predicate/open-predicate` was therefore
  a one-time manual publish, documented along with everything it cost to get right in
  [`RELEASING.md`](https://github.com/OpenPredicate/open-predicate/blob/main/RELEASING.md#trusted-publishing-and-the-one-time-bootstrap) — including that
  *configuring* the trusted publisher needs npm >= 12, which fails with an unexplained `E400` on
  npm 11 because the older client omits the `permissions` field the registry now requires.

- **`@open-predicate/open-predicate` is on npmjs.com**, public and installable, from `0.6.0` on. The
  package is the schema: `require()` it, or `import` it with `{ type: 'json' }`. The trusted
  publisher is configured, so every release from here is published by the workflow rather than by
  hand. GitHub Packages got its first copy with 0.6.1.

## [0.6.0] — 2026-09-13

**A naming release.** No change to the grammar or to the semantics of evaluation:
`open-predicate-schema.json` is byte-identical to 0.5.0 apart from three lines — its `$id`, its
`title` and its `$comment` — and the `$id` still names `v0.4.0`, because the `$id` version tracks
the grammar and the grammar did not move. Consumers pinning that `$id` have only the new namespace
to re-point at.

### Changed

- **The name is settled, and the project has a dedicated organisation.** **OpenPredicate** is
  stewarded by the [OpenPredicate](https://openpredicate.tech) organisation, whose purpose is to
  carry the grammar to an open standard and push for its adoption. This is the single pass the
  README promised: the repository, both package names, the schema `$id`, the problem-type URIs,
  the CLI and the vendor keyword all derive from the one namespace, so nothing is left
  half-named.

  | | Name |
  | --- | --- |
  | Repository | [`OpenPredicate/open-predicate`](https://github.com/OpenPredicate/open-predicate) |
  | Schema file | `open-predicate-schema.json` |
  | Schema `$id` | `https://openpredicate.tech/schema/v0.4.0/open-predicate-schema.json` |
  | Problem types | `https://openpredicate.tech/problems/…` |
  | npm package | `open-predicate` |
  | GitHub Packages | `@openpredicate/open-predicate` |
  | CLI | `open-predicate-generate` |
  | Vendor keyword | `x-open-predicate` |
  | Generator config | `open-predicate.config.json` |

  **Migration.** Mechanical, and only for identifiers — no filter valid before this release becomes
  invalid, because the grammar and the evaluation semantics did not move. In a resource schema, the
  vendor keyword the generator reads is `x-open-predicate`; any other spelling is silently ignored,
  so a field you meant to exclude would become queryable. Point any `$ref` or pinned `$id` at the
  `$id` above, and any RFC 9457 `type` matching at the problem base above. A generator config file
  is `open-predicate.config.json`, or pass it explicitly with `--config`. The `$id` still names
  `v0.4.0` — the version tracks the grammar, which is unchanged; only the namespace it sits under
  is new. Nothing was ever served or published under any other namespace or package name, so no
  working deployment can be pinned elsewhere.

  **On the entries below.** Past releases are written up in these names, so the whole document
  reads in one vocabulary. Released artefacts are unaffected — this names the project, not history.

### Added

- **Brand assets, in [`assets/`](https://github.com/OpenPredicate/open-predicate/tree/main/assets/).** The `{ > }` mark — JSON braces around a comparison —
  as SVG and as raster at three sizes, plus a wordmark for light and dark backgrounds.
  [`assets/README.md`](https://github.com/OpenPredicate/open-predicate/blob/main/assets/README.md) states the palette and the usage rules. The README now
  opens with the mark. MIT-licensed with the rest of the repository.

## [0.5.0] — 2026-09-13

**A tooling release.** No change to the grammar or to the semantics of evaluation:
`open-predicate-schema.json` is byte-identical to 0.4.0 apart from its root `description`, and its
`$id` still names `v0.4.0`, because the `$id` version tracks the grammar and the grammar did not
move. Consumers pinning that `$id` have nothing to do.

What did move is the generator, which is now the thing an API provider uses when implementing
search: point it at the resource schema, state the slice of the language you can actually serve,
and get back a filter schema that permits exactly that slice plus a capability document that
describes it honestly. It also travels with the package for the first time, as a `bin` named
`open-predicate-generate`, rather than being a file inside a repository nobody installs.

[SPEC.md](./SPEC.md) gains two clarifications in service of that, both about what an
implementation may *claim* rather than about what a filter means:
[§2.1](./SPEC.md#21-profiles) says out loud that accepting part of a profile is permitted and
advertising it is not, and [§2.2](./SPEC.md#22-capability-discovery) documents the capability
document's top-level members. No filter valid under 0.4.0 becomes invalid.

### Added

- **The generator selects capabilities, not just profiles**
  ([#11](https://github.com/OpenPredicate/open-predicate/issues/11)). Profiles are the unit
  a server advertises, but three shapes do not fit inside one: a backend with `LIKE` and no
  `POSITION` supports `$like` and not `$contains`; a key-value store cannot implement `$exists` at
  all; a provider compiling to a flat conjunctive index wants one AND level and no shorthand. Six
  new knobs, each available as a flag and as a JS API option — `--operators`, `--drop-operators`,
  `--no-shorthand`, `--max-filter-depth`, `--limits`, and `--config` to hold the combination. What
  is declined is absent from the generated schema, so a client learns it from validation rather
  than from an `unsupported-operator` at runtime. Defaults are unchanged: with none of them given
  the output is byte-identical to before.
- **`--config <file>`, and `examples/pet.open-predicate.config.json`.** The capability selection is a
  decision about the endpoint, not a shell invocation, so it goes in a JSON file checked in beside
  the resource schema and regenerated from. Its keys are the JS API's option names plus `resource`,
  `out` and `capabilities`; relative paths in it resolve against its own directory, an explicit
  flag beats it, and an unrecognised key is refused rather than ignored — a misspelled key is a
  capability that silently did not apply. `npm run generate:example` now runs through one.
- **`--max-filter-depth <n>`** caps how deep `$and`/`$or`/`$nor`/`$not` may nest: `1` is a flat
  filter offering no logical operators at all, `2` permits one level of them. JSON Schema
  cannot count how deep an instance already is, so the filter is emitted as a chain of levels:
  level *i* offers the logical operators over level *i+1* and the last level does not offer them
  at all. Every level shares the operand `$defs`, so the cost is *n* copies of a map of `$ref`s.
  Field-level `$not` is bounded to a single application by the same flag — under Kleene logic
  `¬¬X ≡ X` even for UNKNOWN, so a negated negation says nothing the plain constraint does not.
- **`--limits <json|@file>`** puts the SPEC §7 numbers a provider actually enforces into the
  capability document. They were emitted unconditionally, so every document generated from the CLI
  claimed `maxDepth: 10, maxClauses: 100, maxSetLength: 1000` whether or not that was true. Where
  `--max-filter-depth` is given and `maxDepth` is not, the enforced bound is published.
- **The generator is part of the package.** `tools/` was not in `package.json` `files` and there
  was no `bin` entry, so the tool the README points readers at could not travel with the package
  at all. It is now a `bin` named `open-predicate-generate`, with
  `@open-predicate/open-predicate/generate` exporting `generateFilterSchema` for programmatic use.
  At the time of this release the repository still published no artifacts, so the command was
  reachable from a clone or a git install and not from npmjs; what changed here is that it was
  ready to be, and `npm pack` contained it. Publishing arrived in 0.6.0.
- **[SPEC.md §2.2](./SPEC.md#22-capability-discovery) documents the capability document's
  top-level members** — `queryLanguage`, `profiles`, `fields`, `limits` and `filterSchema` — in a
  table beside the existing per-field one. `limits` appeared in the example and in no table, and
  `filterSchema`, `itemValues` and `nullable` were emitted by the generator and described nowhere.
  No normative change to what the members mean.
- **[SPEC.md §2.1](./SPEC.md#21-profiles) says what a partial profile may and may not do.** The
  rule was already there — a profile other than `core` is implemented in full or not at all — but
  it read as a prohibition on the implementation rather than on the advertisement. An endpoint
  accepting part of a profile is not prohibited from existing; it states what it accepts per path
  and omits the incomplete profile from `profiles`.
- **`examples/mcp-server/`** — a runnable MCP server whose one tool, `search_pets`, takes a
  filter as its `filter` argument and nothing else. The tool's `inputSchema` is
  `examples/pet.filter.json` inlined verbatim; validation is ajv against that same file, and
  execution is the SQL compiler from `experiments/filter-to-sql` over an in-memory SQLite table,
  so the queries are real. `node examples/mcp-server/demo.mjs` drives it over stdio and prints a
  transcript: two filters that answer, one that shows the `$unknownAs` difference (4 matches
  against 7), and the three valid-but-wrong filters from README §*Exposing search to an agent*
  being rejected with a pointer at the clause. `npm run example:mcp` and
  `npm run example:mcp:demo` are the entry points.
- The example is also the first place the `$id`-when-inlining hazard is written down: nested
  under `properties.filter`, a bundled schema's self-references resolve against its own `$id`, so
  removing the `$id` breaks it — ajv fails to compile it at all.

### Changed

- **The capability document's `profiles` reports coverage rather than the request.** It echoed
  whatever `--profiles` was given; it now lists only the profiles the final operator set covers in
  full, because [SPEC.md §2.1](./SPEC.md#21-profiles) makes a partial profile one an
  implementation may not advertise. `--drop-operators '$contains'` therefore costs the `strings`
  claim, and the per-field `operators` lists carry what is on offer instead — with a warning on
  stderr naming the operator responsible. Declining a `core` operator drops `core` too, and warns
  that the result is not a conforming implementation. Nothing changes for a selection that is
  whole profiles, which is every invocation before this release.
- **Positioned as one JSON-Schema-described query language with two integration points**, rather
  than as an agent interface. An earlier revision in this same unreleased window led with the MCP
  tool definition and moved §*Exposing search to an agent* ahead of the OpenAPI and generator
  sections; that ordering is reverted and the "search interface for agents" framing is gone from
  the README, the `package.json` description and the repository description. The agent use case
  keeps its section and its runnable server — it is one of the two things the schema is for, not
  the thing the document opens with.
- **The schema's root `description`** likewise leads with the shared-grammar framing again, and
  mentions inlining as a tool's input schema second. Non-normative prose; no validator behaviour
  changes.
- **The error format is no longer mandated.** [SPEC.md §8](./SPEC.md#8-errors) required
  [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details with media type
  `application/problem+json`. It now requires only that a rejected filter be answered with
  `400 Bad Request` and that the response say **which** of the five conditions applies —
  `malformed-query`, `unknown-field`, `unsupported-operator`, `invalid-operand`,
  `query-too-complex` — because that is what a client branches on. The envelope is the API's own:
  an API with an established error format should express these conditions in it rather than carry
  a second format for one endpoint. RFC 9457 remains the RECOMMENDED default where there is none,
  and the `type` URIs, the `pointer` member and the recovery members (`queryableFields`,
  `accepted`) are unchanged as its encoding. This relaxes a requirement, so nothing that
  conformed before stops conforming.

### Fixed

- **`--max-depth` accepted a value that was not a number.** It was coerced with `Number()` and
  never checked, so `--max-depth deep` became `NaN` and silently stopped the walk at the first
  nested object. It and `--max-filter-depth` are both validated now.
- **An operator whose dependency was dropped is dropped with it.** `$flags` carries
  `dependentRequired: ["$regex"]` out of the grammar, so `--drop-operators '$regex'` would have
  left `$flags` in `properties` with a rule naming a member `additionalProperties: false` forbids
  — present in the schema and impossible to use. The closure is read off
  `$defs/ConstraintObject`, so a dependency added later is handled by construction.
- **Generated filter schemas were not a narrowing** ([#8](https://github.com/OpenPredicate/open-predicate/issues/8)).
  `tools/generate-filter-schema.mjs` carried the published constraint object's
  `dependentRequired` rule but not its `dependentSchemas` one, so `{"microchip": {"$unknownAs":
  false}}` — a modifier with nothing to modify — passed a generated schema while
  `open-predicate-schema.json` rejected it. A server following the documented path (generated
  schema as the tool's `inputSchema`, published semantics behind it) then had to evaluate a filter
  with no predicate in it; the SQL compiler in `experiments/filter-to-sql` emitted
  `coalesce((), FALSE)` and the database answered with a syntax error. The generator now reads
  both dependency keywords off `$defs/ConstraintObject` instead of restating either, so a rule
  added there reaches generated schemas with the version that introduces it, and
  `examples/pet.filter.json` is regenerated: 12 of its 18 constraint objects gain the rule — the
  ones offering `$unknownAs`, which is every field that can be absent or null. The `$comment`
  justifying the rule is deliberately not copied along with it: a validator never reads it, and
  one copy per field is charged by the token to whoever inlines the schema in a tool definition.
  No change to the grammar — this is the generator agreeing with it.
- **The narrowing property is now tested as a property.** `tests/generator.test.mjs` asserted it
  over a hand-written list of fifteen filters, which can only re-check the leaks someone already
  thought of — the keyword above was dropped for as long as the list existed. It now samples
  filters out of each generated schema's own vocabulary (`tests/fuzz.mjs`, seeded, deterministic)
  and asserts that every one the generated schema accepts is valid OpenPredicate, over three generated
  schemas; the run is checked for not being vacuous, in that it must accept a fraction of its
  samples and must reach every operator the schema offers. A second test pins what the generator
  does with each instance-constraining keyword of `$defs/ConstraintObject`, so adding one there
  fails the suite until it is handled.
- **`experiments/filter-to-sql` rejects a constraint object with no predicate in it** rather than
  emitting an empty expression — `malformed-query`, at the pointer of the offending clause. Both
  schemas already reject these, so this only matters for a compiler reached another way, but the
  failure it replaces was a `500` from the database.
- The prose in [README §Errors](./README.md#errors), [COMPARISON.md §4](./COMPARISON.md), the
  OpenAPI examples and `experiments/filter-to-sql` follows: they now describe Problem Details as
  the recommended shape rather than the required one, and name the failing *condition* where they
  previously said "problem". The examples still model RFC 9457, since it is still the default a
  greenfield API should pick.

## [0.4.0] — 2026-09-07

**Breaking.** The `$id` is now `…/v0.4.0/open-predicate-schema.json`. This release resolves the
three operator overlaps that an external review and this repository's own
`experiments/filter-to-sql` flagged independently; the design and the evidence are in
[`decisions/0001-array-quantifiers-and-unknown-handling.md`](https://github.com/OpenPredicate/open-predicate/blob/main/decisions/0001-array-quantifiers-and-unknown-handling.md).

The headline is that the language had **two** unrelated mechanisms for looking inside an array —
`$elemMatch` and the `[*]` path segment — and one mechanism now does both jobs while naming its
quantifier. Operator count is unchanged at 34.

### Added

- **`$some` and `$every`** (profile `collections`), the element quantifiers. Each takes a `Filter`
  when the elements are objects — paths inside resolve against the element — or a constraint
  object when they are scalars. `$some` is `$elemMatch` renamed; `$every` is new, because
  universal quantification over elements was **not previously expressible**: `$not` over `$some`
  is "no element matches", which is a different predicate.
- **`$unknownAs`** (profile `core`), a boolean modifier on a constraint object that resolves that
  constraint's UNKNOWN. `{"status": {"$ne": "archived", "$unknownAs": true}}` is the one-clause
  form of the `$or`/`$isNull` longhand this specification prescribed before. It applies last —
  after every sibling operator, including a field-level `$not` — and [SPEC.md
  §4.6](./SPEC.md#46-resolving-unknown--unknownas) gives the scope rules and the nine-case proof
  that resolution distributes over three-valued AND. It requires at least one operator beside it.
- **A truth-table column for `$nor`** in §4.1, and a note that all three connectives are
  commutative so the six rows cover all nine combinations. `$nor`'s three-valued result previously
  had to be derived, and the derivation was the trap.
- **`$every` on generated schemas**, and `$unknownAs` on exactly the fields where UNKNOWN is
  reachable — the same rule the generator already applied to `$exists` and `$isNull`. On a
  property that is required all the way up and cannot hold null, the modifier would be a constant,
  so it is omitted and the trap disappears from the tool definition entirely.

### Removed — breaking

- **`$elemMatch`.** Renamed to `$some`. Mechanical: `{"items": {"$elemMatch": {…}}}` →
  `{"items": {"$some": {…}}}`.
- **`$hasAny` and `$hasNone`.** Both were compositions of a quantifier and `$in`, and their
  presence beside whole-value `$in` was the whole `$in`-versus-membership confusion.
  `{"tags": {"$hasAny": ["a"]}}` → `{"tags": {"$some": {"$in": ["a"]}}}`;
  `{"tags": {"$hasNone": ["a"]}}` → `{"tags": {"$not": {"$some": {"$in": ["a"]}}}}`.
- **The `[*]` wildcard path segment**, from the §3.2 grammar. It expressed nothing the equivalent
  `$some` clauses do not: per-constraint existential scope is exactly what an `$and` of *separate*
  `$some` clauses means. `{"items[*].qty": {"$gt": 2}}` →
  `{"items": {"$some": {"qty": {"$gt": 2}}}}`. Three further reasons it went: living in the path
  grammar made it the only construct present in **every** profile including `core`, so no server
  could decline it; it contradicted §4.2 by revoking `$exists`'s totality; and it cost 1.74× the
  SQL of the equivalent `$elemMatch` plus a table-valued join per clause. The schema now rejects a
  `[*]` path outright, including in `$field` position, so a stale filter is a validation error
  rather than a path read as a literal key name.
- **`$defs/ScalarSet`.** `$in` and `$nin` now take `$defs/OperandSet`, the same set definition the
  collection operators use. The two definitions had silently diverged — `$hasAny` accepted `$field`
  references and object members while `$in` accepted only scalars — with nothing in the
  specification acknowledging it. The unification is toward the permissive side, so no filter that
  was valid becomes invalid.

### Changed — breaking

- **A type-mismatched equality is FALSE, not UNKNOWN.** §4.3 said comparing different JSON types
  yields UNKNOWN; §5.1 defined `$eq` as structural equality, under which a string and a number are
  simply unequal. The two readings are indistinguishable under `$eq` and differ under `$ne`, and
  the specification asserted both. It is now settled as **FALSE for the equality family**
  (`$eq`, `$ne`, `$in`, `$nin`, `$hasAll`) and UNKNOWN for ordering, string and array operators,
  with a table in §4.3. **This changes result sets without changing any filter's shape**, so a
  mechanical rewrite will not surface it: `{"notes": {"$ne": 3}}` now matches a record whose
  `notes` is `"hello"`.
- **An empty array under a former wildcard clause.** `[*]` on `[]` was UNKNOWN, because the path
  resolved to nothing; `$some` on `[]` is FALSE, because an empty array is a resolved value and
  nothing in it satisfies the condition. `$every` on `[]` is TRUE, vacuously. Observable under
  negation only, and it is the one migration step a codemod cannot claim to preserve.
- **§3.4 resolution is single-valued.** With no wildcard segment, a path yields zero values or
  exactly one. The sequence model is gone.
- **Six operator descriptions that contradicted §4.1.** These strings are vendored verbatim into
  generated schemas and MCP tool definitions, so they were a first-order cause of the confusion
  rather than a cosmetic issue. `$nor`'s was outright wrong — "None of the listed filters may
  evaluate TRUE" is the two-valued reading — and `$ne`'s said only "Field does not equal the
  operand". `$nin`, `$nbetween`, `$nlike` and `$nilike` all read as total predicates. Every
  negative operator now states what it does with UNKNOWN.
- **§1 no longer calls the filter "a boolean function"** while §4.1 makes it three-valued.
- **`$exists` is documented as unconditionally total.** It always was, except under a wildcard
  path; with those gone the exception is gone.
- **§3.5 settles whether an index suffix is a separate path.** It is not: `items[0]` is the field
  `items` for queryability, while a named member beneath it (`items[0].sku`) is its own path.
- **§7 addresses quantifier cost.** `$some` and `$every` are the expensive operators on most
  backends, and a server that cannot afford them can decline the `collections` profile — which is
  precisely what the `[*]` segment made impossible.

### Fixed

- **`$some`/`$every`'s operand shape is no longer ambiguous.** `anyOf: [Filter, ConstraintObject]`
  overlaps on a leading `$not`, and nothing said which was meant. §5.8 now gives a decidable rule:
  scan for the first member that can only be one of the two, recursing through `$not`/`$and`/`$or`/
  `$nor` bodies when the outer member is itself ambiguous.
- **`$field` inside a quantifier resolves against the element**, stated in §5.8 and §5.11. §5.11
  said "the same record" while §5.8 said paths were element-relative; both readings were
  defensible.

## [0.3.1] — 2026-09-04

No change to the schema, the grammar or the semantics. `open-predicate-schema.json` is
byte-identical to 0.3.0 and its `$id` still names `v0.3.0`, because the `$id` version tracks the
grammar and the grammar did not move. Consumers pinning that `$id` have nothing to do.

### Removed

- **Publishing.** The release workflow no longer ships to npmjs.com or GitHub Packages. Neither
  registry ever received a copy, and neither should before the name is final: publishing claims a
  name, and npm blocks a name from reuse permanently once it has been published and unpublished. `.github/workflows/release.yml` now only verifies a release —
  the test suite, and the tag-against-`package.json` check — and uploads nothing. The
  `NPM_TOKEN` secret and `.github/scripts/version-published.sh` are deleted with it.
  [RELEASING.md](https://github.com/OpenPredicate/open-predicate/blob/main/RELEASING.md#turning-publishing-back-on) keeps what the jobs needed, so they
  can be restored from git history rather than rewritten.

### Changed

- **README no longer offers an install that does not exist.** The Quickstart opened with
  `npm install --save-dev open-predicate`, which the README's own *Status* table already
  contradicted two screens further down. It now vendors the file by `curl`, which is the only
  way to obtain the schema and always was.
- **[RELEASING.md](https://github.com/OpenPredicate/open-predicate/blob/main/RELEASING.md) documents the process that exists** — a tag and a GitHub
  Release, carrying notes and a source snapshot and nothing else.

## [0.3.0] — 2026-09-04

Guidance for adopters exposing a search endpoint to an LLM agent, the tooling that acts on it,
and an honest statement of how finished this is. No grammar change: every filter valid under
v0.2.0 remains valid, and the only edits to `open-predicate-schema.json` are two `description`
annotations and its version strings.

### Added

- **Per-field domains in the capability document.** [SPEC.md §2.2](./SPEC.md#22-capability-discovery)'s
  RECOMMENDED shape now carries `type`, `format`, `values` and `description` alongside
  `operators`, with a table defining each. The grammar cannot express per-field operand
  domains — every path shares one `Constraint` — so a filter naming a real field with an
  out-of-domain value is well-formed and matches nothing. The capability document is the only
  place that domain can be stated.
- **Recovery members on problem details.** [SPEC.md §8](./SPEC.md#8-errors) now RECOMMENDS that
  `unknown-field` carry `queryableFields` and that `invalid-operand` carry `accepted`, so a
  client that never fetched the capability document can still converge in one round trip
  instead of guessing field names one at a time.
- **README §*Exposing search to an agent*** — what reaches a tool definition, the three
  valid-but-wrong filters that fail as an empty result set, and the five steps that prevent
  them (bundle rather than remote-`$ref`, narrow `FieldPath`, publish value domains, trim to
  advertised profiles, state the null and `$in` semantics in the tool description).

- **`tools/generate-filter-schema.mjs`** — derives a per-resource filter schema from the
  resource's own JSON Schema. The published grammar shares one `Constraint` across every field,
  so it can say `{"status": "Available"}` is well-formed but not that `"Available"` is outside
  `status`'s domain; that is why [SPEC.md §2.2](./SPEC.md#22-capability-discovery) exists. A
  generated schema gives each queryable path its own constraint subschema, carrying only the
  operators that apply to its type and only the operands its domain admits — so the three
  valid-but-wrong filters catalogued in README §*Exposing search to an agent* become validation
  failures instead of empty result sets. The generator emits the §2.2 capability document from
  the same source, and copies operator prose out of the published grammar rather than restating
  it. Generation is narrowing only: every filter a generated schema accepts is valid against the
  published grammar, which `tests/generator.test.mjs` asserts.
- **`COMPARISON.md`** — how this specification relates to GraphQL, and what a JSON-Schema-native
  alternative to GraphQL would still need. The short version: GraphQL never standardised
  filtering, so the two overlap far less than the question assumes. Also covers OData, JSON:API,
  OGC CQL2 and JSON Hyper-Schema as prior art.
- **`examples/pet.schema.json`** with its generated `pet.filter.json` and `pet.capabilities.json`
  committed beside it, and `npm run generate:example` to refresh them. A test fails if they drift.
- **README §*Generating a per-resource filter schema*** — what the generator decides and why, and
  the `x-open-predicate` property annotations that override it.

### Changed

- **README framing.** The schema is presented as feeding two integration paths rather than
  one: `$ref`'d from an OpenAPI document, or bundled into an MCP tool's `inputSchema`. The
  *Referencing by URL or by copy* table gains an `MCP inputSchema` row recording that the
  absolute-URL form does not work there at all, since nothing on that path resolves remote
  refs.
- `$in` and `$nin` descriptions now state that they compare the whole value and do not test
  array membership, naming `$hasAny`/`$hasNone` as the element operators. `$contains` already
  warned about the same crossover; these two did not, and they are the operators a client
  carrying MongoDB habits reaches for first.
- **`$id` is now `…/v0.3.0/open-predicate-schema.json`.** Consumers pin by `$id`, so the version
  in the path moves with the release. `SPEC.md`, the OpenAPI examples and the generated
  capability document were all still naming v0.2.0; they now agree.
- **README §*Status* states that this is a work in progress, name included.** The name is not
  final, and every identifier downstream of it — both package names, the `$id`, the URLs in the
  integration examples — is a placeholder, several of which do not
  resolve. Getting them right is deliberately deferred until the name is settled, because a
  rename moves all of them at once. A notice at the top of the README says the same thing before
  a reader reaches an install command that will not work.
- **`QUERY` now cites [RFC 10008](https://www.rfc-editor.org/rfc/rfc10008)** rather than
  `draft-ietf-httpbis-safe-method-w-body`. The method reached Proposed Standard in June 2026.
  The advice to ship `POST /search` alongside it is unchanged, but the reason is now that
  deployed support trails a fresh RFC, not that the specification is unsettled.

## [0.2.0] — 2026-08-06

A structural rewrite. The v0.1.0 file described a grammar but did not enforce one; this
release makes it a working schema, fixes the grammar's dead ends, and completes the operator
set. Filters written against v0.1.0 still parse apart from the `$isnull` rename.

### Fixed

- **The schema validated nothing.** The root used `"id"` (a draft-04 spelling) rather than
  `"$id"`, and wrapped its definitions in `components.schemas`, which is an OpenAPI container
  and not a JSON Schema keyword. Under draft 2020-12 both were unknown keywords, and the root
  carried no assertion keywords at all — so a validator pointed at the file accepted every
  instance. The root now `$ref`s `#/$defs/Filter`.
- **`"regex"` is not a JSON Schema keyword** (it is `"pattern"`), and the value it carried —
  `"['\"%?.+%?['\"]"` — was a malformed character class that also expected quote characters
  inside the operand. `$like` and `$nlike` are now plain strings; the wildcard and escape
  grammar is specified in prose ([SPEC.md §5.5](./SPEC.md#55-pattern-matching--like-nlike-ilike-nilike))
  where it belongs.
- **`examples` was an object** throughout, in the OpenAPI Example-Object style, where JSON
  Schema requires an array of instance values; two schemas used the OpenAPI 3.0 singular
  `example`. Both spellings are now correct, and a test walks the whole document to keep them
  that way.
- **Operators from different families could not be combined on one field.** The eight-way
  `oneOf` over leaf condition types meant `{"age": {"$gt": 18, "$ne": 30}}` matched no branch
  and was rejected. Sibling operators now AND together.
- **Ambiguous and empty forms were accepted or accidentally rejected.** `{}` matched all eight
  leaf branches at once; `{"$and": […], "$or": […]}` was accepted with no defined semantics;
  `$and: []` and `$in: []` were accepted. Empty forms are now rejected, and implicit AND across
  siblings is specified.
- **`$in`/`$nin` excluded booleans and `null`** while `$eq` allowed them.

### Changed — breaking

| v0.1.0 | v0.2.0 | Note |
| --- | --- | --- |
| `"id": "…/v0.1.0"` | `"$id": "…/v0.2.0/open-predicate-schema.json"` | Correct keyword, versioned path |
| `#/components/schemas/Query` | `#/$defs/Filter` | Or `$ref` the file itself |
| `#/components/schemas/Condition` | *(removed)* | Folded into `#/$defs/Filter` |
| `#/components/schemas/equalCondition`, `notEqualCondition`, `inArrayCondition`, `notInArrayCondition`, `likeCondition`, `notLikeCondition`, `rangeCondition`, `isNullCondition` | *(removed)* | Folded into `#/$defs/ConstraintObject` |
| `$isnull` | `$isNull` | Renamed for consistency with `$startsWith` &c. |

Any OpenAPI document referencing a `#/components/schemas/…` pointer must be repointed. Filter
*documents* need no change other than `$isnull` → `$isNull`; the v0.1.0 examples are kept as
test fixtures to prove it.

### Added

- **Operators.** `$nor`; `$nbetween`; `$ilike`, `$nilike`, `$startsWith`, `$endsWith`,
  `$contains`; `$regex` with `$flags`; `$exists`; `$type`; `$hasAny`, `$hasAll`, `$hasNone`,
  `$size`, `$elemMatch`; `$search`; a field-level `$not`.
- **Field-to-field comparison** via `{"$field": "path"}` in operand position — SQL's
  `WHERE price > cost` — with `{"$literal": …}` as the escape for object operands that would
  otherwise read as references.
- **Scalar shorthand.** `{"status": "open"}` for `{"status": {"$eq": "open"}}`. Restricted to
  strings, numbers, booleans and `null`, so `{"tags": ["a"]}` can never be read ambiguously.
- **`null`, arrays and objects as `$eq`/`$ne` operands.**
- **A field path grammar** — dotted paths, array indices, `[*]` wildcards, `\.` dot escaping —
  and a rule for field names beginning with `$`: they are escaped by doubling (`$$price`).
  A single `$` prefix that is not a known operator is now rejected, so `$eqq` is an error
  rather than a field name.
- **Conformance profiles**, published in the schema as `x-profiles` and specified in
  [SPEC.md §2.1](./SPEC.md#21-profiles), so a server can advertise the subset it implements.
- **One override point for the queryable field set**, `#/$defs/FieldPath`, reached through
  `propertyNames` so that narrowing it in a bundled copy applies at every nesting level.
- **[SPEC.md](./SPEC.md)** — three-valued logic, missing-versus-null, coercion rules, per-operator
  semantics, safety limits, and an RFC 9457 problem-type registry.
- **[README.md](./README.md)** — operator reference and OpenAPI 3.1 / 3.2 integration guidance.
- **Tests and CI** — ajv under `strict: true`, 30 valid and 22 invalid fixtures, and Redocly
  linting of both OpenAPI examples.

### Notes

`$dynamicRef`/`$dynamicAnchor` was evaluated as a way to let consumers restrict the queryable
field set without copying the file, and rejected: ajv 8.20 does not resolve it correctly even
for the canonical recursive case, and OpenAPI tooling support is worse. The `$ref`-based
override described in the README works in every validator.

## [0.1.0] — 2025-02-05

Initial research draft: `$and`, `$or`, `$not` over eight leaf condition types
(`$eq`, `$ne`, `$in`, `$nin`, `$like`, `$nlike`, `$gt`/`$gte`/`$lt`/`$lte`/`$between`, `$isnull`),
laid out as an OpenAPI `components.schemas` fragment.

[0.6.2]: https://github.com/OpenPredicate/open-predicate/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/OpenPredicate/open-predicate/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/OpenPredicate/open-predicate/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/OpenPredicate/open-predicate/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/OpenPredicate/open-predicate/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/OpenPredicate/open-predicate/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/OpenPredicate/open-predicate/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/OpenPredicate/open-predicate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/OpenPredicate/open-predicate/releases/tag/v0.1.0
