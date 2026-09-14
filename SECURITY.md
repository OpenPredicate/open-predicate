# Security policy

## What this project is, and what that means for a report

OpenPredicate is a **specification and a JSON Schema**, plus a generator and some examples. It has no
runtime dependencies and executes nothing on a server. So a security report here is usually not
"this code is exploitable" but one of two other things, and both are in scope:

1. **A defect in the specification that makes conforming implementations unsafe.** A rule that, if
   followed, produces a vulnerability. These are the serious ones, because they replicate into every
   implementation.
2. **A vulnerability in the shipped tooling** — `tools/generate-filter-schema.mjs`, the published npm
   package, the examples, or the release pipeline.

## In scope

A filter is user-supplied input that becomes a query plan, and [SPEC.md §7](./SPEC.md) bounds it
normatively. Reports that land squarely in scope include:

- **A filter that stays within the §7 limits and is still superlinear.** The recommended defaults are
  depth 10, 100 clauses, 1000 set members, 64 KiB body and 100 ms per `$regex` per record. A filter
  that satisfies all five and still degrades a reasonable backend is a specification bug — the limits
  are drawn in the wrong place.
- **A `$regex` operand that defeats the 100 ms guidance**, or a case where the advice to prefer a
  non-backtracking engine is insufficient rather than merely inconvenient.
- **Anything that causes a predicate to be dropped, widened or truncated.** This is the failure mode
  the specification treats as most dangerous: §2.1 forbids silently ignoring an unsupported operator
  and §7 forbids truncating an over-limit filter, both because a filter that matches *more* than
  asked is an authorization bypass wherever filters carry tenancy or visibility. If you find a path
  through the spec where a conforming implementation ends up widening a result set, report it here
  rather than as a design objection.
- **An injection or escaping defect** in the filter-to-SQL compiler under
  [`experiments/filter-to-sql/`](./experiments/filter-to-sql), even though it is explicitly an
  exercise and not a deliverable. It is the thing people will read to learn how to compile a filter,
  so an unsafe pattern in it propagates.
- **Schema-level resource exhaustion**: a document that makes a conforming validator behave
  pathologically, including through the recursive `$ref` structure or the generator's emitted output.
- **Anything in the supply chain**: the trusted-publisher configuration, the release workflow, or a
  published tarball that does not match the repository.

## Out of scope

- Vulnerabilities in *your* server that come from not implementing §7 at all. Bounding a filter is
  `MUST`; not doing it is a bug in the implementation, and the answer is to implement the limits.
- Denial of service from unindexed fields where the capability document was not used to restrict
  expensive operators to indexed ones — §7 already says to do this. Report it if the guidance is
  *wrong*, not if it was skipped.
- Design objections with no safety consequence. Those are welcome, but as a
  [design objection](./CONTRIBUTING.md) issue, in public.
- Reports against `npm install open-predicate`, the unscoped deprecated placeholder, which holds two
  files and no code.

## Supported versions

Pre-1.0, **only the latest release is supported.** Fixes land on `main` and ship in the next release;
there are no backports. Versioned schema `$id`s are immutable by policy ([SPEC.md §9](./SPEC.md)), so
a security fix that changes the grammar produces a *new* version rather than altering a published
one — an implementation pinned to an old `$id` must move to get the fix, and the `CHANGELOG.md`
migration note will say so.

| Version | Supported |
| --- | --- |
| 0.6.x | Yes |
| < 0.6 | No |

## Reporting

**Do not open a public issue for anything in the *In scope* list above.**

Use GitHub's private vulnerability reporting —
[**Report a vulnerability**](https://github.com/OpenPredicate/open-predicate/security/advisories/new)
— which keeps the report private until an advisory is published. If that is unavailable to you, email
**contact@openpredicate.tech**; say in the subject line that it is a security report, and do not
include exploit details in the first message if you would rather establish the channel first.

Please include the filter, the schema version, and what a conforming implementation does with it.
A reproducing filter is worth more than a description of one.

## What happens next

- **Acknowledgement within 7 days**, and an initial assessment within 14. There is one maintainer;
  if you have heard nothing after 14 days, send a reminder rather than assuming it was ignored.
- **A fix or a decision, in writing.** If a report turns out to be a specification defect, the
  resolution goes through a [decision record](./GOVERNANCE.md) like any other normative change — with
  the difference that the record is published when the fix ships, not while it is embargoed.
- **Coordinated disclosure.** We will agree a date with you, defaulting to 90 days or the fix,
  whichever is sooner. Because this is a specification, a defect in class (1) above may need other
  implementers notified before it is public; if that applies we will tell you, and say who.
- **Credit** in the advisory and the changelog, under whatever name you choose, or none.

There is no bug bounty. This is an unfunded single-maintainer project and pretending otherwise would
waste your time.
