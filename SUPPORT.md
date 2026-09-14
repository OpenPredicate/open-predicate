# Getting help

**One maintainer, no service-level agreement.** Everything here is best-effort, usually within a week.
Knowing that up front is more useful than a promise that does not hold.

## Where to go

| You want to | Go to |
| --- | --- |
| Try a filter and see it validate | The [playground](https://openpredicate.tech/playground/) — runs the real schema in your browser and shows the error a conforming server would return |
| Know what an operator means, normatively | [`SPEC.md`](./SPEC.md), or the generated [operator reference](https://openpredicate.tech/operators/) |
| Ask how to do something | [Discussions → Q&A](https://github.com/OpenPredicate/open-predicate/discussions) |
| Argue that a design decision is wrong | An issue, using the *design objection* template — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) |
| Report that the schema and the spec disagree | An issue, using the *spec ambiguity* template |
| Report a security or denial-of-service concern | [`SECURITY.md`](./SECURITY.md) — **not** a public issue |
| Say you have implemented it | An issue, using the *implementation report* template. These are the most welcome issues the project receives |
| Understand why a decision was made | [`decisions/`](./decisions) and [`CHANGELOG.md`](./CHANGELOG.md), which carries a migration note for every break |
| Know how this compares to GraphQL, OData, CQL2, Mongo or JSONPath | [`COMPARISON.md`](./COMPARISON.md), including the gaps it admits |

## Questions that already have answers

Three things surprise almost everyone, and all three are deliberate:

- **Sibling members AND together, and a bare scalar means `$eq`.** `{"status": "open", "rank": 3}`
  is `status = 'open' AND rank = 3`. You only need `$and` to repeat a field, or to nest inside `$or`.
- **A comparison against `null` or an absent field is UNKNOWN, not FALSE — and only TRUE matches.**
  So `{"status": {"$ne": "archived"}}` does **not** match a record whose status is missing. That is
  SQL's behaviour. When you want those records, say so: `{"$ne": "archived", "$unknownAs": true}`.
- **`$in` does not look inside arrays.** It is whole-value comparison. Element membership is
  `{"tags": {"$some": {"$in": [...]}}}`. This differs from MongoDB on purpose — overloading `$in`
  makes the meaning depend on data a validator cannot see.

## Versions

Pre-1.0: only the latest release is supported, and the grammar may still break before 1.0. Pin an
exact version if you depend on it. The schema `$id` is versioned and immutable — `v0.4.0` will always
return the bytes it returned the day it was published — so `$ref`-ing a versioned `$id` is the
safe thing to do. There is deliberately no `latest` URL.
