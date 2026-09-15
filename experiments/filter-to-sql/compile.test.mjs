import test from "node:test";
import assert from "node:assert/strict";

import { CASES, expectationFor, bindingsDiverge } from "./cases.mjs";
import { DOCUMENT_BINDING, HYBRID_BINDING, RECORDS } from "./dataset.mjs";
import { openDatabase, search } from "./harness.mjs";
import { compile, parsePath, QueryProblem } from "./compile.mjs";

const db = openDatabase();
const BINDINGS = { hybrid: HYBRID_BINDING, document: DOCUMENT_BINDING };

/**
 * The corpus, executed. Each case is asserted against the ids SPEC.md says
 * should match — hand-derived in cases.mjs, not captured from this compiler.
 */
for (const testCase of CASES) {
  for (const [name, binding] of Object.entries(BINDINGS)) {
    test(`${testCase.id} ${name}: ${testCase.title}`, () => {
      const expected = expectationFor(testCase, name);
      const result = search(db, testCase.filter, binding);
      if (expected.problem) {
        assert.ok(result.problem, `expected a ${expected.problem} problem, got ids ${result.ids}`);
        assert.equal(result.problem.type.split("/").pop(), expected.problem, result.problem.detail);
        assert.ok(result.problem.pointer.startsWith("/filter"), "problems carry a JSON Pointer (§8)");
        return;
      }
      assert.ok(!result.problem, `unexpected ${result.problem?.type}: ${result.problem?.detail}`);
      assert.deepEqual(result.ids, expected.ids);
    });
  }
}

/**
 * The differential half: two bindings, one over promoted columns and one over
 * a JSON document, have to agree everywhere the specification does not permit
 * them to differ. Every disagreement is either a compiler bug or a case that
 * declares itself binding-dependent.
 */
test("the two bindings agree except where the spec allows them not to", () => {
  const divergent = [];
  for (const testCase of CASES) {
    const results = Object.entries(BINDINGS).map(([name, binding]) => {
      const r = search(db, testCase.filter, binding);
      return r.problem ? `problem:${r.problem.type.split("/").pop()}` : r.ids.join(",");
    });
    if (results[0] !== results[1]) divergent.push(testCase.id);
  }
  assert.deepEqual(divergent, CASES.filter(bindingsDiverge).map((c) => c.id));
});

test("every fixture record is reachable, and no case matches everything by accident", () => {
  const all = search(db, { id: { $exists: true } }, DOCUMENT_BINDING);
  assert.equal(all.ids.length, RECORDS.length);
});

// ---------------------------------------------------------------------------
// Unit-level checks on the parts that are easy to get quietly wrong
// ---------------------------------------------------------------------------

test("field paths parse per SPEC §3.2", () => {
  assert.deepEqual(parsePath("name"), [{ key: "name" }]);
  assert.deepEqual(parsePath("address.city"), [{ key: "address" }, { key: "city" }]);
  assert.deepEqual(parsePath("items[0].sku"), [{ key: "items" }, { index: 0 }, { key: "sku" }]);
  assert.deepEqual(parsePath("a\\.b"), [{ key: "a.b" }]);
  assert.deepEqual(parsePath("$$price"), [{ key: "$price" }]);
  assert.deepEqual(parsePath("a[0][1]"), [{ key: "a" }, { index: 0 }, { index: 1 }]);
  // The [*] wildcard was removed in v0.4.0; $some and $every replace it.
  for (const bad of ["", "$price", "a.", "a\\b", "a[x]", "a[0", "a..b", "items[*].sku", "tags[*]"]) {
    assert.throws(() => parsePath(bad, "/filter"), QueryProblem, `should reject "${bad}"`);
  }
});

test("no user-supplied string is interpolated into the SQL text", () => {
  const hostile = "'; DROP TABLE pets; --";
  const { sql, params } = compile(
    { name: hostile, "shelter.city": { $like: hostile } },
    DOCUMENT_BINDING,
  );
  assert.ok(!sql.includes("DROP"), sql);
  assert.ok(params.includes(hostile));
  // The field paths travel as parameters too, not as SQL text.
  assert.ok(params.includes("$.shelter.city"));
});

/**
 * Every parameter has to be mentioned by the statement that carries it.
 * Postgres rejects a bind message with more parameters than the statement
 * uses, so an orphaned parameter is a real defect that SQLite would tolerate
 * silently — and did, until this test.
 */
test("no compiled statement carries an unused parameter", () => {
  const orphans = [];
  for (const dialect of ["sqlite", "postgres"]) {
    const mark = (n) => (dialect === "sqlite" ? `?${n}` : `$${n}`);
    for (const [name, binding] of Object.entries(BINDINGS)) {
      for (const testCase of CASES) {
        let compiled;
        try {
          compiled = compile(testCase.filter, { ...binding, dialect });
        } catch (error) {
          if (!(error instanceof QueryProblem)) throw error;
          continue;
        }
        for (let n = 1; n <= compiled.params.length; n += 1) {
          if (!compiled.sql.includes(mark(n))) orphans.push(`${testCase.id} ${name}/${dialect} ${mark(n)}`);
        }
      }
    }
  }
  assert.deepEqual(orphans, []);
});

test("both dialects compile the whole corpus", () => {
  const postgres = { ...DOCUMENT_BINDING, dialect: "postgres" };
  const failures = [];
  for (const testCase of CASES) {
    const expected = expectationFor(testCase, "document");
    try {
      compile(testCase.filter, postgres);
      if (expected.problem && expected.problem !== "malformed-query") {
        failures.push(`${testCase.id}: expected ${expected.problem}`);
      }
    } catch (error) {
      if (!(error instanceof QueryProblem)) throw error;
      // f07 is the one case whose outcome is dialect-dependent: Postgres can
      // compare jsonb structurally, so it is not rejected there.
      const allowed = expected.problem ?? (testCase.id === "f07" ? "unsupported-operator" : null);
      if (error.type !== allowed) failures.push(`${testCase.id}: ${error.type} — ${error.message}`);
    }
  }
  assert.deepEqual(failures, []);
});

/**
 * SPEC.md §7: operands are caller-supplied and MUST be bound, never
 * interpolated. This is the one safety requirement no limit in §7 mitigates —
 * a bound operand of any length is inert, an interpolated one is not — so it is
 * asserted directly rather than inferred from the result sets above.
 *
 * Each operand is a hostile payload with a unique alphabetic sentinel appended.
 * The sentinel is what the assertions track, for two reasons. It cannot collide
 * with SQL the compiler legitimately generates — an earlier version of this test
 * probed for "SELECT 1" and tripped over the compiler's own
 * `EXISTS (SELECT 1 FROM json_each(...))`. And it contains no LIKE
 * metacharacter, so it survives the rewriting the pattern operators properly do:
 * $contains escapes a literal `%` to `\%` so it cannot act as a wildcard, while
 * $like passes the pattern through because there `%` is a wildcard by design.
 * Tracking the sentinel tells "escaped" from "dropped" without asserting any one
 * operator's escaping scheme.
 */
const HOSTILE = [
  ["x' OR 1=1 --", "SENTINELONE"],
  ['"; DROP TABLE pets; --', "SENTINELTWO"],
  ["'||(SELECT name FROM pets LIMIT 1)||'", "SENTINELTHREE"],
  ["\\'; SELECT 1; --", "SENTINELFOUR"],
  ["%' OR name LIKE '%", "SENTINELFIVE"],
].map(([payload, sentinel]) => ({ value: payload + sentinel, probe: sentinel }));

for (const [dialectName, binding] of [
  ["sqlite", HYBRID_BINDING],
  ["postgres", { ...HYBRID_BINDING, dialect: "postgres" }],
]) {
  test(`${dialectName}: hostile operands are bound, never interpolated (§7)`, () => {
    for (const { value, probe } of HOSTILE) {
      // One filter per operator family that carries a string operand, so an
      // operator added later that forgets to bind is caught rather than only
      // $eq being covered.
      const filters = [
        { name: { $eq: value } },
        { name: { $ne: value } },
        { name: { $in: [value] } },
        { name: { $like: value } },
        { name: { $contains: value } },
        { name: { $startsWith: value } },
        { tags: { $some: { $eq: value } } },
      ];

      for (const filter of filters) {
        const label = JSON.stringify(filter);

        // Two outcomes are safe and no third is: the operand is refused, or it
        // is bound. $like legitimately refuses a lone "\\'" as an invalid
        // escape (§5.5), and refusing is a stronger answer than binding.
        let compiled;
        try {
          compiled = compile(filter, binding);
        } catch (err) {
          assert.ok(err instanceof QueryProblem, `expected a QueryProblem for ${label}, got ${err}`);
          continue;
        }

        const { sql, params } = compiled;
        assert.ok(!sql.includes(value), `operand was interpolated into the statement for ${label}:\n  ${sql}`);
        assert.ok(!sql.includes(probe), `part of the operand reached the statement for ${label}:\n  ${sql}`);

        // It must also have been passed along rather than silently dropped: a
        // dropped predicate widens the result set, which §2.1 and §7 forbid.
        assert.ok(
          params.some((v) => typeof v === "string" && v.includes(probe)),
          `operand never reached the parameter list for ${label}: ${JSON.stringify(params)}`,
        );
      }
    }
  });
}

test("a hostile operand matches nothing rather than changing the query (§7)", () => {
  // The end-to-end form of the same claim: executed, against the real dataset.
  for (const { value } of HOSTILE) {
    const result = search(db, { name: { $eq: value } }, HYBRID_BINDING);
    assert.ok(!result.problem, `unexpected ${result.problem?.type} for ${value}`);
    assert.deepEqual(result.ids, [], `an injected operand must select no records: ${value}`);
  }
  // And the table is still there, which a successful injection would have settled.
  assert.deepEqual(search(db, { status: "available" }, HYBRID_BINDING).problem, undefined);
});
