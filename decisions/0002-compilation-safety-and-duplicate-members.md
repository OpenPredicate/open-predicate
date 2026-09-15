# 0002 — Compilation safety, and duplicate member names

**Status:** proposed · **Affects:** SPEC.md §2.3 (new), §7 · **Grammar version:** unchanged

## Context

Writing the IANA registration for `application/vnd.openpredicate+json` surfaced two requirements the
specification relies on and never states. RFC 6838 §4.6 makes a security considerations section
mandatory and requires, among other things, that a registration referencing an existing format
describe the issues specific to using *that* format. Answering it honestly meant writing, in a
document that points at `SPEC.md` as the published specification, that the specification does not
address the thing every implementation has to get right.

Two gaps, from opposite ends of the pipeline.

**The specification never mentions injection.** The premise of this project is that a JSON-encoded
predicate compiles to a backend query. Every operand in it is caller-supplied. `SPEC.md` contains no
occurrence of *injection*, *bound*, *parameter* in that sense, or *escape* outside the `$like`
grammar — so the one obligation that decides whether an implementation is safe or catastrophic is
absent from the normative text. The project's position exists everywhere else: `SECURITY.md` lists
"an injection or escaping defect in the filter-to-SQL compiler" as in scope for a security report,
and `experiments/filter-to-sql` binds every operand and has done from the first commit. Only the
specification is silent, which is the one place an independent implementer reads.

**Duplicate member names are undefined, and this architecture is unusually exposed to that.** RFC
8259 §4 says object member names SHOULD be unique and declines to define the outcome when they are
not. The specification inherits that silence. It matters here more than it would elsewhere, because
the design deliberately separates validation from evaluation: a JSON Schema approves the filter, and
something else executes it. Those are two parsers. Where they resolve `{"$gt": 18, "$gt": 65}`
differently, the filter that was approved is not the filter that ran, and neither component has
malfunctioned. For a predicate that carries tenancy or visibility, that is an authorization bypass
assembled entirely out of conforming parts.

### What this record does not do

It does not add, remove or change an operator, and it does not touch the schema. It changes what a
conforming implementation must do with a filter before and after the grammar has its say.

## Decision 1 — operands are bound, paths are whitelisted

§7 gains two paragraphs. Operands MUST be passed to the backend as bound parameters or through its
own escaping facility, and MUST NOT be concatenated into a statement.

The second paragraph is the one worth arguing. Field paths are caller-supplied in exactly the same
way, and an identifier generally cannot be bound as a parameter — so the symmetric rule is
unavailable and the temptation is to escape the path instead. The record rejects that. An
implementation MUST resolve each path against the field set it exposes (§3.5) and reject anything
unrecognised with `unknown-field`. Refusing an unknown path is a whitelist and is decidable from
information the implementation already has; escaping one is a guess about the backend's quoting
rules, and quoting rules are where identifier injection lives. §3.5 and §8 already provide both
halves of the whitelist, so this states a consequence rather than inventing a mechanism.

Placing this in §7 is a small stretch of that section's title — *Safety limits* — but the section
already carries safety guidance that is not a limit: prefer a linear-time regex engine, restrict
expensive operators to indexed fields, publish a lower `maxDepth` for quantifiers. A separate
section would have been tidier and would have renumbered §8 through §10 and every cross-reference in
the README, the schema descriptions, the site and `decisions/0001`. Not worth it.

## Decision 2 — duplicate member names are rejected, at the parser

A new §2.3 requires an implementation to reject an object containing a duplicate member name with
`malformed-query`, and forbids resolving the duplication by preferring an occurrence.

Rejection rather than a defined precedence rule. Defining "last wins" would make the outcome
predictable and would not fix anything: the two parsers in a conforming deployment are usually not
both ours, so a rule we state cannot make a third-party JSON parser obey it. A filter whose meaning
depends on a behaviour the specification cannot enforce should not be accepted at all. Rejection is
also the only option that fails loudly, which is the stance the rest of the document takes — §2.1
forbids silently ignoring an unsupported operator, §7 forbids truncating an over-limit filter, and
both for the same reason: a filter that matches more than it says is the worst failure available.

**This requirement cannot be tested through the schema, and that is the point.** JSON Schema
constrains a parsed instance; by then the duplication has collapsed and `JSON.parse` has already
chosen a winner. So the requirement binds the parser, and §2.3 says so explicitly. The test suite
cannot express it, and no fixture is added — a fixture would have to be a *document*, and
`tests/fixtures/` holds parsed instances. An implementer whose parser cannot report duplicates has
to detect them while reading or change parser, which §2.3 states.

The same subsection records the adjacent ordering constraint, because it has the same shape and the
same cause: the §7 limits bound evaluation, not parsing, and a parser exhausted by nesting depth has
failed before any limit applies. An implementation must bound its input independently.

## Migration

Nothing to migrate for a caller. No filter that was valid becomes invalid, with one exception that
was never well-defined: a filter containing a duplicate member name was previously accepted by
whichever reading the implementation's parser happened to take, and is now rejected with
`malformed-query`. No such filter had a specified meaning, so none can be said to have worked.

For an implementer, both decisions are conformance requirements that may already hold:

- If operands are already bound, Decision 1 is a no-op. If they are interpolated, that is a
  vulnerability being described rather than introduced.
- If the JSON parser rejects or reports duplicates, Decision 2 is a no-op. Several do not by
  default, and the check has to be added at the read boundary.

## Costs and risks

- **§7's title is now slightly wrong.** Accepted, with the renumbering argument above. If §7 is ever
  split, the title goes with it.
- **§2.3 asks for something some parsers make awkward.** `JSON.parse` offers no duplicate reporting;
  detection means a streaming parser, a reviver-based trick, or a pre-scan. This is a real cost
  imposed on implementers, and it buys the elimination of a divergence class that is otherwise
  undetectable at run time.
- **The registration now cites sections that must not drift.** The IANA submission quotes §2.3 and
  §7 by number. A future renumbering would strand it.
- **Neither decision is enforced by the test suite for its own sake.** Decision 1 gains a real
  regression test in `experiments/filter-to-sql`; Decision 2 gains none, for the structural reason
  above. A normative requirement no test can reach is weaker than one a test can, and that asymmetry
  is recorded rather than hidden.

## Open question

**Should `malformed-query` be the condition for a duplicate member, or should there be a distinct
one?** Settled: `malformed-query`, whose §8 definition is "the body does not conform to the schema:
unknown operator, wrong operand type, structural error". A duplicate member is a structural error and
needs no new problem type; a new type would also mean a new URI under
`https://openpredicate.tech/problems/`, and five conditions that each mean something distinct are
worth more than six where two overlap. Reconsider if implementers report that clients cannot tell a
duplicate member from a schema violation and that the distinction changes what a client does about
it — the `pointer` of §8 already locates the clause either way.

## Follow-ups, explicitly out of scope

- Defining the media type itself in `SPEC.md`. The registration needs a normative §Media type
  section with the parameters it declares; that is its own record, and this one only fixes what the
  registration's security considerations exposed.
- The `profile` media type parameter, deliberately not registered for now.
- Whether §7's RECOMMENDED limits are the right numbers. Untouched here.
- Guidance on composing a caller's predicate with a server's authorization predicate. The
  registration says it must be by conjunction; the specification still does not, because the
  enclosing request body is out of scope per §1 and the right home is unclear.

## Results

`SPEC.md` gains §2.3 and two paragraphs in §7. The schema is byte-identical and the `$id` still
names `v0.4.0`: both decisions constrain implementations rather than the grammar, and §9 ties the
`$id` to the grammar — the same reasoning that left the `$id` alone through 0.5.0 and 0.6.0.
`experiments/filter-to-sql/compile.test.mjs` gains a test asserting that no operand appears
literally in emitted SQL, in both dialects, which is Decision 1 made checkable.
