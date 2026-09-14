# Contributing

**Disagreement is the most useful contribution at this stage.**

That is not politeness. OpenPredicate is pre-1.0 with no known adopters, which means every design
defect is still free to fix — and after adoption each one is permanent. The most valuable thing you
can do is find the construct that will be regretted and say so while saying so is cheap.

There is precedent. Three operator overlaps — `$in` against `$hasAny`, `$elemMatch` against wildcard
paths, and three-valued `$not`/`$ne` silently excluding nulls — were removed in v0.4.0 because an
external survey and this repository's own
[`experiments/filter-to-sql`](./experiments/filter-to-sql) converged on the same three
independently. Both reviews were unsolicited. See
[`decisions/0001`](./decisions/0001-array-quantifiers-and-unknown-handling.md) for what happened to
them.

So: if something here looks wrong, file it. You do not need to propose a replacement, and you do not
need to be sure.

## Three entry points

### 1. File a design objection

Use the *design objection* issue template. A good objection names three things:

- **The construct.** Quote the operator, the rule, or the section of [`SPEC.md`](./SPEC.md).
- **The failure.** What goes wrong — a filter that cannot be expressed, two ways to write the same
  thing, a semantic that surprises, a rule an implementation cannot enforce. A concrete filter and
  the result you expected beats a description.
- **What it should be instead**, if you have a view. Optional. "This is wrong and I do not know the
  fix" is a legitimate and useful issue.

The bar for *adding* an operator is deliberately high, and it is stated in `decisions/0001`:
**a construct definable in terms of another does not earn a name.** That is why `$none` is not in
the grammar — it is `$not` over `$some`. An objection that argues a construct is *hard to write
correctly* in its definable form is the argument that can move this; an objection that it is merely
absent will not.

Out of scope by design, per [SPEC.md §1](./SPEC.md): projection, ordering, pagination, grouping and
joins. Confining this schema to the predicate is what makes it reusable across endpoints, and
[`COMPARISON.md`](./COMPARISON.md) §5 sets out what the layers above it would require if they are
ever built. Proposals to add them now will be declined until the filter layer has external
implementers.

### 2. Build an implementation — or make implementing it cheaper

The specification is written normatively so that independent implementations can agree, rather than
deferring to a reference implementation. So a second implementation is worth more here than a
feature, and the evidence says it is small work:
[`experiments/filter-to-sql`](./experiments/filter-to-sql) covers 33 of 34 operators in one
dependency-free file, and the part everyone worries about — UNKNOWN — is 23 lines of it.

**Be aware of what the test assets currently are and are not.** This matters if you are planning to
port them:

- [`tests/fixtures/`](./tests/fixtures) holds 32 valid and 28 invalid filters as declarative JSON.
  They are portable in shape, and there is a test asserting every operator in the grammar is
  exercised by at least one of them — the operator table and the fixture set are the same list.
- They check **schema well-formedness only.** There are no records and no expected results, so they
  cannot tell you whether an *evaluator* is correct, which is the part you would actually be writing.
- The `expectKeyword` member on invalid fixtures names a JSON Schema keyword and is therefore
  ajv-flavoured, not portable.
- `tests/` is excluded from the published npm package, so today the fixtures reach you only by
  cloning.

**The highest-value single contribution available is closing that gap**, and most of the raw material
exists: `experiments/filter-to-sql/cases.mjs` is already 73 cases over 10 records in the shape
`{group, id, title, filter, expect}` — an evaluation corpus in everything but name. It is currently
labelled *"an exercise, not a deliverable"*. Promoting it into a versioned, language-agnostic
conformance suite with portable rejection cases (keyed to the five error conditions in
[SPEC.md §8](./SPEC.md) rather than to ajv keywords) and shipping it in the package is open work, and
it is wanted. Say so in an issue before starting so the shape can be agreed.

Where two implementations disagree about a case, that disagreement is a specification defect. Report
it as a *spec ambiguity* — those are the most valuable issues this project can receive.

### 3. Claim conformance for a library that already exists

If you maintain a filter evaluator — anything in the `$eq`/`$in`/`$and` family — you may already be
most of the way to conforming, and the specification is built to let you say so honestly rather than
all-or-nothing. [SPEC.md §2.1](./SPEC.md) requires only that you:

- implement the `core` profile in full;
- advertise **only** the profiles you implement completely, stating anything partial per-field
  through the `operators` member of §2.2 instead;
- reject an operator you do not support with an `unsupported-operator` error — never silently drop
  the clause, because dropping a predicate *widens* the result set, which is the most dangerous
  possible failure mode for an authorization-adjacent filter.

File an *implementation report* with what you support and what you had to leave out. The gaps are
the useful half: a profile boundary that nobody can implement cleanly is a boundary drawn in the
wrong place, and that is a specification bug.

## Working in the repository

```bash
npm ci
npm test          # 132 tests: schema meta-validation, fixtures, generator, narrowing property
```

CI additionally runs the suite on Node 20, 22 and 24, and lints both OpenAPI example documents with
`@redocly/cli`. Everything is ESM JavaScript on Node with no runtime dependencies; the only
dev-dependencies are `ajv` and `ajv-formats`. Please keep it that way — a specification repository
that is expensive to check out is a specification with fewer implementations.

A few invariants the tests enforce, so you find out from CI rather than from review: the schema
meta-validates under `ajv` in strict mode; `x-profiles` covers exactly the operators the grammar
defines; every operator has at least one valid fixture; the generator's committed output in
`examples/` must not drift; and a narrowed `$defs/FieldPath` must restrict fields at every nesting
depth.

Commit messages are sentence-shaped and say what the change does to the project, not what was
edited — *"Stop mandating an error format; mandate the error conditions"*, not *"update SPEC.md"*.
Normative changes need a [decision record](./GOVERNANCE.md) and a `CHANGELOG.md` entry with a
migration note; [`GOVERNANCE.md`](./GOVERNANCE.md) has the table of what each class of change costs.

## Adding your own operators without waiting for us

You do not need permission, and you should not wait. [SPEC.md §6](./SPEC.md) reserves the bare `$`
namespace for the specification and gives you the rest: prefix your operator distinctly (`$x_`, or a
vendor tag such as `$acme_geoWithin`) and document it. An endpoint that adds an operator no longer
validates against the published schema, so it SHOULD publish an extended schema that `allOf`-composes
or bundles this one, and MUST NOT advertise the unmodified `$id`.

If a vendor-prefixed operator turns out to be one everybody needs, that is exactly the evidence a
decision record wants, and it is a far stronger case than a proposal with no implementation behind
it.

## Conduct

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md). It is short, and it makes
one thing explicit that matters more here than in most projects: blunt technical disagreement is
welcome and is not incivility. The distinction it draws is between attacking an argument and
attacking a person.
