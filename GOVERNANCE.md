# Governance

This document says how decisions get made, who makes them, what earns someone a say, and
what happens when people disagree. It exists because the [stated purpose](./README.md#about-openpredicate)
of the OpenPredicate organisation is to take this grammar *from a single-author design to an
open standard*, and a standard whose decision process is undocumented is still a single-author
design no matter how the specification is written.

## Current state, stated plainly

**There is one maintainer:** Christos Gkoros ([@christosgkoros](https://github.com/christosgkoros)),
who is also the specification editor. Every commit in the history is his. No external contributor
has yet filed an issue or a pull request.

That is a defect, not a design. It is the single largest obstacle to the word *standard* applying
here, and it ranks above every feature on the roadmap. The rest of this document is written so
that the process does not have to be invented at the moment a second person shows up.

## Three classes of change

What a change is determines what it costs to make. The dividing line is whether it can alter
what a conforming implementation must do.

| Class | Examples | Requires |
| --- | --- | --- |
| **Editorial** | Typos, clarifications that cannot change behaviour, examples, tooling, tests, site copy | A pull request. One maintainer approval. |
| **Substantive, compatible** | A new optional profile member, a new capability-document field, generator features, new fixtures | An issue first, then a pull request that references it. A `CHANGELOG.md` entry. |
| **Normative** | Adding, removing or renaming an operator; changing semantics, three-valued logic, coercion, error conditions or the safety limits; anything that changes what `MUST` happen | A **decision record** under [`decisions/`](https://github.com/OpenPredicate/open-predicate/tree/main/decisions), merged before or with the implementation. A `CHANGELOG.md` entry with a migration note. A `$id` version bump per [SPEC.md §9](./SPEC.md). |

If it is unclear which class a change falls into, it is normative. The cost of over-documenting a
change is a file nobody needed; the cost of under-documenting one is an implementer who cannot tell
whether their implementation is still conforming.

## Decision records are the mechanism

Significant design decisions are argued in writing under [`decisions/`](https://github.com/OpenPredicate/open-predicate/tree/main/decisions) rather than
settled by commit message. There is currently **exactly one record** —
[`0001-array-quantifiers-and-unknown-handling.md`](https://github.com/OpenPredicate/open-predicate/blob/main/decisions/0001-array-quantifiers-and-unknown-handling.md).
More are expected, and at least two are already owed: the resolution of
[#1](https://github.com/OpenPredicate/open-predicate/issues/1) (scalar shorthand forcing `anyOf` on
`Constraint`) and [#2](https://github.com/OpenPredicate/open-predicate/issues/2) (the capability
document being RECOMMENDED at an unspecified location).

A record is numbered, committed, and thereafter immutable in substance — it is superseded by a later
record rather than edited, so the reasoning available at the time stays legible. `0001` is the
worked example of the expected shape: **Context** (including what the record does *not* do),
one section per **Decision**, **Migration** for anything breaking, **Costs and risks**,
**Open question** for what it deliberately leaves unsettled, **Follow-ups, explicitly out of
scope**, and **Results**.

Two conventions in `0001` are load-bearing and carry forward:

- **Record what you decided against, and why.** `0001` spends a section on why `$every` is included
  and `$none` is not, and marks it as the one place its own two criteria pull against each other.
  That is more useful to a future implementer than the decision itself.
- **Name the evidence.** `0001` resolved three operator overlaps because an external survey and this
  repository's own `experiments/filter-to-sql` converged on the same three independently. A record
  that cites only taste is weaker than one that cites a measurement, and the project has a standing
  bias toward building the measurement.

## How a disputed design call is resolved

The project's position is that [disagreement is the most useful contribution at this
stage](./CONTRIBUTING.md), so the process is built to absorb it rather than to close it quickly.

1. **The objection is filed** as an issue, using the *design objection* template.
2. **It gets answered in writing.** A maintainer must respond on the substance — not merely close
   it. "Working as intended" is not an answer unless it says why the intent is right.
3. **If it survives that, it becomes a decision record**, and the objection is quoted in the
   Context section in the objector's words rather than paraphrased.
4. **Lazy consensus decides it.** A proposed record that has sat for **14 days** with no unresolved
   objection from a maintainer is accepted. Any maintainer may extend that window once by asking.
5. **If maintainers still disagree, the specification editor decides — and the dissent is recorded
   in the record itself**, attributed, with its reasoning intact. A standard that hides its
   disagreements makes its own history unusable.

Nothing in this process applies to correctness. A demonstrated bug — a filter the schema accepts
and the spec forbids, or vice versa — is fixed, not debated.

## What earns commit rights

Commit rights follow demonstrated judgement about *this* grammar, not volume. Any one of these is
sufficient to be proposed as a maintainer:

- **Two accepted substantive or normative contributions**, at least one of which changed the
  specification text.
- **An authored decision record that was accepted**, including one that argued successfully against
  the editor.
- **An independent implementation that is shipped and maintained**, and that passes the fixtures in
  [`tests/fixtures/`](https://github.com/OpenPredicate/open-predicate/tree/main/tests/fixtures). Implementers are the constituency this specification exists
  to serve, and their view of an ambiguity outranks the editor's intent about it.

A maintainer is added by consensus of the existing maintainers, announced in a decision record, and
listed below. Maintainers who have been inactive for twelve months move to emeritus, keeping
attribution and losing the commit bit; this is bookkeeping, not a judgement, and it reverses on
request.

**Maintainers:** Christos Gkoros ([@christosgkoros](https://github.com/christosgkoros)),
specification editor.

## Intellectual property and patents

The specification, the schema and this repository are [MIT](./LICENSE)-licensed, so the grammar can
be implemented, vendored, extended and re-specified by anyone, commercially or otherwise, without
permission and without royalty. MIT settles copyright. It says nothing about patents, and for a
specification that silence is the thing an adopter's lawyer notices first — so the project's
position is stated explicitly:

**OpenPredicate is intended to be implementable royalty-free by anyone.** The maintainers are aware
of no patent claims covering the grammar, and will not knowingly accept a contribution encumbered by
one. By contributing, you confirm that you are entitled to submit the work, and you grant to anyone
implementing this specification a perpetual, worldwide, non-exclusive, royalty-free licence under
any patent claims you own or control that are necessarily infringed by implementing your
contribution. If you know of a claim that would encumber an implementation — yours or anyone's —
disclose it in the pull request. A contribution that cannot be implemented freely will be declined
however good the design is.

Should the specification enter a formal standards venue, the venue's IPR rules govern instead — for
the IETF, that is [BCP 78](https://www.rfc-editor.org/info/bcp78) and
[BCP 79](https://www.rfc-editor.org/info/bcp79) — and this section will be superseded rather than
reinterpreted.

## Changing this document

This document is itself normative about process, so changing it is a normative change: it takes a
decision record. The first genuinely useful amendment will be the one that removes "there is one
maintainer" from the top.
