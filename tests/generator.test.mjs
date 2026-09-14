import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import _Ajv2020 from "ajv/dist/2020.js";
import _addFormats from "ajv-formats";

import { generateFilterSchema, resolveOptions } from "../tools/generate-filter-schema.mjs";
import { sampler, operatorsIn, operatorsUsed } from "./fuzz.mjs";

const Ajv2020 = _Ajv2020.default ?? _Ajv2020;
const addFormats = _addFormats.default ?? _addFormats;

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

const grammar = JSON.parse(readFileSync(join(repo, "open-predicate-schema.json"), "utf8"));
const pet = JSON.parse(readFileSync(join(repo, "examples", "pet.schema.json"), "utf8"));

function makeAjv() {
  const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
  addFormats(ajv);
  ajv.addVocabulary(["x-profiles", "x-open-predicate"]);
  return ajv;
}

const { schema: generated, capabilities, warnings } = generateFilterSchema(pet, {
  id: "https://api.example.com/schemas/pet.filter.json",
});

const validate = makeAjv().compile(generated);
const validateGrammar = makeAjv().compile(grammar);

const errs = (v) => makeAjv().errorsText(v.errors, { separator: "; " });

test("the generated schema compiles under ajv strict mode", () => {
  const ajv = makeAjv();
  assert.ok(ajv.validateSchema(generated), ajv.errorsText(ajv.errors, { separator: "\n" }));
});

test("generation is deterministic", () => {
  const again = generateFilterSchema(pet, { id: "https://api.example.com/schemas/pet.filter.json" });
  assert.equal(JSON.stringify(again.schema), JSON.stringify(generated));
});

test("the committed example outputs are up to date", () => {
  // These are the artefacts README points readers at; a drifted copy is worse
  // than none, because it is the one people will read instead of running the tool.
  const onDisk = JSON.parse(readFileSync(join(repo, "examples", "pet.filter.json"), "utf8"));
  const capsOnDisk = JSON.parse(readFileSync(join(repo, "examples", "pet.capabilities.json"), "utf8"));
  assert.deepEqual(onDisk, generated, "run: npm run generate:example");
  assert.deepEqual(capsOnDisk, capabilities, "run: npm run generate:example");
});

test("no warnings for a well-typed resource schema", () => {
  assert.deepEqual(warnings, []);
});

const ACCEPTED = [
  ["scalar shorthand on a closed domain", { status: "available" }],
  ["explicit equality", { status: { $eq: "sold" } }],
  ["set membership over the domain", { species: { $in: ["cat", "dog"] } }],
  ["date ordering", { born: { $gte: "2020-01-01" } }],
  ["inclusive range on a number", { weightKg: { $between: [2, 8] } }],
  ["array membership, quantified", { tags: { $some: { $in: ["rescue", "senior"] } } }],
  ["operand-side quantifier", { tags: { $hasAll: ["rescue", "senior"] } }],
  ["array length", { tags: { $size: { $gte: 1 } } }],
  ["existential condition over an array of scalars", { tags: { $some: { $startsWith: "adopt-" } } }],
  ["universal condition over an array of scalars", { tags: { $every: { $startsWith: "adopt-" } } }],
  ["existential condition over an array of objects", {
    vaccinations: { $some: { vaccine: "rabies", administeredAt: { $gt: "2024-01-01T00:00:00Z" } } },
  }],
  ["universal condition over an array of objects", {
    vaccinations: { $every: { vaccine: "rabies" } },
  }],
  ["nested object path", { "shelter.city": { $ilike: "%amsterdam%" } }],
  ["null handling spelled out", { $or: [{ microchip: { $ne: "X" } }, { microchip: { $isNull: true } }] }],
  ["null handling as a modifier", { microchip: { $ne: "X", $unknownAs: true } }],
  ["presence of an optional object", { shelter: { $exists: true } }],
  ["nested logic", {
    $and: [
      { status: "available" },
      { $or: [{ species: { $in: ["cat", "dog"] } }, { tags: { $some: { $in: ["rescue"] } } }] },
      { $not: { neutered: false } },
    ],
  }],
];

for (const [name, filter] of ACCEPTED) {
  test(`accepts: ${name}`, () => {
    assert.ok(validate(filter), errs(validate));
    // Narrowing, on the cases README shows: each of these is legal OpenPredicate too.
    assert.ok(validateGrammar(filter), errs(validateGrammar));
  });
}

const SEED = 20260909;
const SAMPLES = 5000;

test("everything the generated schema accepts, the published grammar also accepts", () => {
  // The soundness property that makes generation safe: narrowing only. A filter
  // written against a generated schema is always a legal OpenPredicate filter, so a
  // server implementing the published semantics can evaluate it unchanged.
  //
  // The property is quantified over every filter, so it is checked by sampling
  // the generated schema's own vocabulary rather than by listing cases: a list
  // can only re-check the leaks someone already thought of. The leak in #8 —
  // a dependency keyword the generator dropped, so a lone $unknownAs passed —
  // sat under a list of fifteen filters that could never have found it.
  const targets = [
    ["pet", generated],
    ["pet, core profile only", generateFilterSchema(pet, { profiles: ["core"] }).schema],
    ["a recursive resource", generateFilterSchema(RECURSIVE_RESOURCE, { maxDepth: 2 }).schema],
    // The three shapes --operators/--drop-operators, --no-shorthand and
    // --max-filter-depth produce. Each one edits the emitted structure, so each
    // one is a fresh chance to emit something the grammar does not accept — and
    // the property, not a case list, is what would notice.
    ["pet, operators dropped", generateFilterSchema(pet, { dropOperators: ["$contains", "$exists", "$regex"] }).schema],
    ["pet, no shorthand", generateFilterSchema(pet, { shorthand: false }).schema],
    ["pet, logical nesting capped", generateFilterSchema(pet, { maxFilterDepth: 2 }).schema],
  ];

  for (const [label, schema] of targets) {
    const accepts = makeAjv().compile(schema);
    const next = sampler(schema, SEED);
    const covered = new Set();
    let accepted = 0;

    for (let i = 0; i < SAMPLES; i++) {
      const filter = next();
      if (!accepts(filter)) continue;
      accepted++;
      operatorsUsed(filter, covered);
      assert.ok(
        validateGrammar(filter),
        `${label}: accepted by the generated schema, rejected by the grammar:\n` +
          `${JSON.stringify(filter)}\n${errs(validateGrammar)}`,
      );
    }

    // A sampler that lands outside the schema every time would pass the loop
    // above without testing anything, and so would one that never reaches an
    // operator. Both are asserted rather than assumed.
    assert.ok(accepted > SAMPLES / 10, `${label}: only ${accepted}/${SAMPLES} samples were accepted`);
    const unreached = [...operatorsIn(schema)].filter((op) => !covered.has(op)).sort();
    assert.deepEqual(unreached, [], `${label}: no accepted sample exercised ${unreached.join(", ")}`);
  }
});

test("a modifier cannot stand alone in a generated constraint object", () => {
  // The regression from #8, at both levels it can occur: $unknownAs has nothing
  // to modify, so the published grammar rejects it and a generated schema that
  // accepted it would be wider than the grammar. `$flags` is the same shape of
  // rule, on the operator that already had it.
  for (const filter of [
    { microchip: { $unknownAs: false } },
    { microchip: { $unknownAs: true } },
    { microchip: { $not: { $unknownAs: true } } },
    { shelter: { $unknownAs: true } },
    { vaccinations: { $some: { boosterDue: { $unknownAs: true } } } },
  ]) {
    assert.equal(validate(filter), false, `expected rejection: ${JSON.stringify(filter)}`);
    assert.equal(validateGrammar(filter), false, `expected the grammar to reject it too: ${JSON.stringify(filter)}`);
  }
  // With something to modify, it is accepted again.
  assert.ok(validate({ microchip: { $ne: "X", $unknownAs: true } }), errs(validate));
});

test("no instance-constraining keyword of the published constraint object is dropped", () => {
  // #8 was one keyword of $defs/ConstraintObject missing from every generated
  // constraint object. This says what the generator does with each of them, so
  // a keyword added to the published definition fails here — rather than in a
  // filter someone's agent emits — until it is handled deliberately.
  const source = grammar.$defs.ConstraintObject;
  const carriesTriggers = (constraint, keyword) => {
    for (const [trigger, rule] of Object.entries(source[keyword])) {
      if (!(trigger in constraint.properties)) continue;
      // Everything that constrains an instance has to survive; $comment is the
      // one part that may be dropped, being prose a validator never reads.
      const expected = Array.isArray(rule)
        ? rule
        : Object.fromEntries(Object.entries(rule).filter(([k]) => k !== "$comment"));
      assert.deepEqual(constraint[keyword]?.[trigger], expected, `${constraint.title}: ${keyword}.${trigger}`);
    }
    return true;
  };
  const handled = {
    type: (c) => c.type === "object",
    minProperties: (c) => c.minProperties >= source.minProperties,
    additionalProperties: (c) => c.additionalProperties === false,
    dependentSchemas: (c) => carriesTriggers(c, "dependentSchemas"),
    dependentRequired: (c) => carriesTriggers(c, "dependentRequired"),
  };

  const ANNOTATIONS = new Set(["title", "description", "examples", "$comment", "properties"]);
  assert.deepEqual(
    Object.keys(source).filter((k) => !ANNOTATIONS.has(k)).sort(),
    Object.keys(handled).sort(),
    "an instance-constraining keyword of $defs/ConstraintObject has no rule here",
  );

  // A generated constraint object is one whose properties are all operators;
  // a generated Filter carries field paths beside them.
  const withFlags = generateFilterSchema(pet, {
    profiles: ["core", "strings", "ranges", "collections", "regex"],
  }).schema;
  const constraints = [generated, withFlags].flatMap((schema) =>
    Object.values(schema.$defs).filter((def) => {
      const names = Object.keys(def?.properties ?? {});
      return names.length > 0 && names.every((n) => n.startsWith("$")) && !("$and" in def.properties);
    }),
  );
  assert.ok(constraints.length > 10, `expected the pet schema to yield constraint objects, got ${constraints.length}`);
  assert.ok(constraints.some((c) => "$flags" in c.properties), "no constraint object offering $flags was checked");
  assert.ok(constraints.some((c) => "$unknownAs" in c.properties), "no constraint object offering $unknownAs was checked");

  for (const constraint of constraints) {
    for (const [keyword, holds] of Object.entries(handled)) {
      assert.ok(holds(constraint), `${constraint.title}: ${keyword} is not carried or narrowed`);
    }
  }
});

const REJECTED = [
  // The three valid-but-wrong filters from README §"Exposing search to an agent".
  // Each is well-formed OpenPredicate — the published grammar accepts all three — and each
  // fails as an empty result set rather than an error. Typing them per field is
  // what turns them into a 400.
  ["value outside a closed domain", { status: "Available" }, "anyOf"],
  ["$in used as array membership", { tags: { $in: ["urgent"] } }, "additionalProperties"],
  ["wrong operand type for an ordered field", { born: { $gte: 2020 } }, "anyOf"],
  // Field-set and operator-set narrowing.
  ["unknown field", { birthDate: "2020-01-01" }, "additionalProperties"],
  ["unknown field nested in $or", { $or: [{ status: "sold" }, { nickname: "Rex" }] }, "additionalProperties"],
  ["field excluded by x-open-predicate", { internalNotes: { $contains: "vet" } }, "additionalProperties"],
  ["operator outside the advertised profiles", { name: { $regex: "^Fi" } }, "additionalProperties"],
  ["ordering on an unordered string", { name: { $gt: "M" } }, "additionalProperties"],
  ["pattern matching on a closed domain", { species: { $like: "ca%" } }, "additionalProperties"],
  ["$exists on an always-present field", { status: { $exists: true } }, "additionalProperties"],
  ["$isNull on a non-nullable field", { name: { $isNull: true } }, "additionalProperties"],
  ["numeric bound outside the field's range", { weightKg: 500 }, "anyOf"],
  ["unknown path inside $some", { vaccinations: { $some: { brand: "x" } } }, "additionalProperties"],
  ["$unknownAs on a field that can never be UNKNOWN", { name: { $eq: "Fido", $unknownAs: true } }, "additionalProperties"],
];

for (const [name, filter, keyword] of REJECTED) {
  test(`rejects: ${name}`, () => {
    assert.equal(validate(filter), false, "expected rejection");
    const keywords = validate.errors.map((e) => e.keyword);
    assert.ok(
      keywords.includes(keyword),
      `expected a '${keyword}' error, got: ${[...new Set(keywords)].join(", ")}`,
    );
  });
}

test("the rejected filters are rejected by narrowing, not by the base grammar", () => {
  // If the published grammar already caught these, per-field typing would be
  // buying nothing. Everything here is legal OpenPredicate that means the wrong thing.
  const alsoIllegalUnderTheGrammar = REJECTED
    .filter(([, filter]) => !validateGrammar(filter))
    .map(([name]) => name);
  assert.deepEqual(alsoIllegalUnderTheGrammar, []);
});

test("profiles trim the operator set", () => {
  const { schema } = generateFilterSchema(pet, { profiles: ["core"] });
  const json = JSON.stringify(schema);
  for (const op of ["$like", "$ilike", "$contains", "$between", "$hasAll", "$size", "$some", "$every", "$regex"]) {
    assert.ok(!json.includes(`"${op}"`), `${op} should not survive a core-only generation`);
  }
  for (const op of ["$eq", "$in", "$gte", "$and"]) {
    assert.ok(json.includes(`"${op}"`), `${op} is core and must survive`);
  }
});

test("an unknown profile is refused rather than silently dropped", () => {
  assert.throws(() => generateFilterSchema(pet, { profiles: ["core", "geo"] }), /unknown profile "geo"/);
  assert.throws(() => generateFilterSchema(pet, { profiles: ["strings"] }), /"core" profile is mandatory/);
});

test("--descriptions trades tokens for prose", () => {
  const brief = JSON.stringify(generateFilterSchema(pet, {}).schema);
  const all = JSON.stringify(generateFilterSchema(pet, { descriptions: "all" }).schema);
  const none = JSON.stringify(generateFilterSchema(pet, { descriptions: "none" }).schema);
  assert.ok(none.length < brief.length && brief.length < all.length);
  // The rules an agent gets wrong survive the default mode.
  assert.ok(brief.includes("it does NOT test membership inside an array-valued field"));
});

test("exclude and max-depth bound the surface", () => {
  const { schema } = generateFilterSchema(pet, { exclude: ["shelter*", "id"] });
  assert.ok(!("id" in schema.properties));
  assert.ok(!("shelter.city" in schema.properties));
  assert.ok("name" in schema.properties);

  const shallow = generateFilterSchema(pet, { maxDepth: 0 });
  assert.ok(!("shelter.city" in shallow.schema.properties));
  assert.ok(shallow.warnings.some((w) => w.includes("max-depth")));
});

const RECURSIVE_RESOURCE = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://example.com/node.json",
  title: "Node",
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string" },
    parent: { $ref: "#" },
    children: { type: "array", items: { $ref: "#" } },
  },
};

test("a recursive resource schema terminates", () => {
  const { schema } = generateFilterSchema(RECURSIVE_RESOURCE, { maxDepth: 2 });
  assert.ok(makeAjv().validateSchema(schema));
  assert.ok("parent.id" in schema.properties, Object.keys(schema.properties).join(", "));
});

test("allOf composition still yields fields", () => {
  const composed = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Composed",
    $defs: { Timestamps: { type: "object", properties: { createdAt: { type: "string", format: "date-time" } } } },
    allOf: [{ $ref: "#/$defs/Timestamps" }],
    type: "object",
    properties: { name: { type: "string" } },
  };
  const { schema } = generateFilterSchema(composed, {});
  assert.deepEqual(Object.keys(schema.properties).filter((k) => !k.startsWith("$")).sort(), ["createdAt", "name"]);
});

test("an untyped property is skipped with a warning rather than guessed at", () => {
  const loose = {
    title: "Loose",
    type: "object",
    properties: { known: { type: "string" }, anything: { description: "no type here" } },
  };
  const { schema, warnings: w } = generateFilterSchema(loose, {});
  assert.ok(!("anything" in schema.properties));
  assert.ok(w.some((m) => m.includes("anything")));
});

test("the capability document describes exactly the generated field set", () => {
  const fromSchema = Object.keys(generated.properties).filter((k) => !k.startsWith("$"));
  assert.deepEqual(Object.keys(capabilities.fields).sort(), fromSchema.sort());
  assert.equal(capabilities.queryLanguage, grammar.$id);
  assert.deepEqual(capabilities.fields.status.values, ["available", "pending", "sold"]);
  assert.equal(capabilities.fields.microchip.nullable, true);
  assert.ok(!("$regex" in capabilities.fields.name.operators));
  // §2.2 requires every advertised operator to be one the profiles imply.
  const enabled = new Set(capabilities.profiles.flatMap((p) => grammar["x-profiles"][p]));
  for (const [path, field] of Object.entries(capabilities.fields)) {
    for (const op of field.operators) {
      assert.ok(enabled.has(op), `${path} advertises ${op}, which no advertised profile provides`);
    }
  }
});

test("the generated schema's operators and the capability document agree", () => {
  for (const [path, field] of Object.entries(capabilities.fields)) {
    const node = generated.properties[path];
    const constraintRef = node.$ref ?? node.anyOf.at(-1).$ref;
    const constraint = generated.$defs[constraintRef.replace("#/$defs/", "")];
    assert.deepEqual(Object.keys(constraint.properties), field.operators, `mismatch on ${path}`);
  }
});

test("--include keeps exactly the named paths, nested ones included", () => {
  const { schema, capabilities: caps, warnings: w } = generateFilterSchema(pet, {
    include: ["status", "shelter.city", "notAField"],
  });
  const paths = Object.keys(schema.properties).filter((k) => !k.startsWith("$"));
  assert.deepEqual(paths.sort(), ["shelter.city", "status"]);
  assert.deepEqual(Object.keys(caps.fields).sort(), ["shelter.city", "status"]);
  assert.ok(w.some((m) => m.includes("notAField")));
  // The defs of pruned fields are unreachable but harmless; what matters is
  // that the schema still compiles and still rejects what it dropped.
  const check = makeAjv().compile(schema);
  assert.ok(check({ status: "sold" }), errs(check));
  assert.equal(check({ name: "Fido" }), false);
});

test("$unknownAs is emitted only where UNKNOWN is reachable", () => {
  // Same rule the generator already applies to $exists and $isNull: a property
  // that is required all the way up and cannot hold null never resolves to
  // nothing, so the modifier would be a constant.
  const { schema } = generateFilterSchema(pet);
  const constraintFor = (path) => {
    const branches = schema.properties[path]?.anyOf ?? [schema.properties[path]];
    const ref = branches.map((b) => b?.$ref).find((r) => r?.includes("/C_"));
    assert.ok(ref, `no constraint object emitted for "${path}"`);
    return schema.$defs[ref.replace("#/$defs/", "")];
  };
  assert.ok(
    !("$unknownAs" in constraintFor("name").properties),
    "name is required and non-nullable — $unknownAs would be a constant",
  );
  assert.ok(
    "$unknownAs" in constraintFor("microchip").properties,
    "microchip is nullable, so UNKNOWN is reachable and the modifier applies",
  );
});

// ---------------------------------------------------------------------------
// Capability selection (#11): the operator set, the emitted shape, and the
// claims the capability document is allowed to make about them.
// ---------------------------------------------------------------------------

/** The constraint object one path resolves to, whichever form the property takes. */
function constraintOf(schema, path) {
  const node = schema.properties[path];
  const ref = node.$ref ?? node.anyOf.at(-1).$ref;
  return schema.$defs[ref.replace("#/$defs/", "")];
}

test("--operators selects within the profiles rather than beyond them", () => {
  const { schema, warnings: w } = generateFilterSchema(pet, {
    profiles: ["core", "strings"],
    operators: ["$eq", "$in", "$like", "$between"],
  });
  assert.deepEqual(Object.keys(constraintOf(schema, "name").properties), ["$eq", "$in", "$like"]);
  // $between is in `ranges`, which was not requested: naming it cannot widen
  // the selection, so the intersection drops it and says why.
  assert.ok(w.some((m) => m.includes("$between") && m.includes("ranges")), w.join("\n"));
  assert.ok(!JSON.stringify(schema).includes('"$between"'));
});

test("an unknown operator is refused rather than silently dropped", () => {
  // The same treatment --profiles gives an unknown profile: a typo in a
  // capability selection is a capability that silently did not apply.
  assert.throws(() => generateFilterSchema(pet, { operators: ["$eq", "$matches"] }), /unknown operator "\$matches"/);
  assert.throws(() => generateFilterSchema(pet, { dropOperators: ["$liek"] }), /unknown operator "\$liek"/);
  assert.throws(() => generateFilterSchema(pet, { operators: [] }), /no operators enabled/);
});

test("--drop-operators reaches the schema and the capability document alike", () => {
  // Issue #11's first shape: a backend with LIKE but no POSITION offers $like
  // and not $contains, which no whole-profile choice can express.
  const { schema, capabilities: caps } = generateFilterSchema(pet, {
    profiles: ["core", "strings"],
    dropOperators: ["$contains"],
  });
  const ops = Object.keys(constraintOf(schema, "name").properties);
  assert.ok(ops.includes("$like") && !ops.includes("$contains"));
  assert.ok(!JSON.stringify(schema).includes('"$contains"'));
  for (const [path, field] of Object.entries(caps.fields)) {
    assert.ok(!field.operators.includes("$contains"), `${path} still advertises $contains`);
  }
});

test("an operator whose dependency was dropped goes with it", () => {
  // $flags carries dependentRequired: ["$regex"] out of the grammar, so keeping
  // it beside a dropped $regex would emit a member that additionalProperties:
  // false forbids — present in the schema and impossible to use.
  const { schema, warnings: w } = generateFilterSchema(pet, {
    profiles: ["core", "regex"],
    dropOperators: ["$regex"],
  });
  const json = JSON.stringify(schema);
  assert.ok(!json.includes('"$flags"'), "$flags outlived the $regex it depends on");
  assert.ok(w.some((m) => m.includes("$flags") && m.includes("$regex")), w.join("\n"));
});

test("the capability document claims only the profiles offered in full", () => {
  // SPEC §2.1: a profile other than core is implemented in full or not at all.
  // Narrowing the *schema* is always legal — it accepts fewer filters than the
  // grammar — but the profile claim is not survivable, and the per-field
  // operator lists are where the truth goes instead (§2.2).
  const partial = generateFilterSchema(pet, {
    profiles: ["core", "strings", "ranges"],
    dropOperators: ["$contains"],
  });
  assert.deepEqual(partial.capabilities.profiles, ["core", "ranges"]);
  assert.ok(partial.capabilities.fields.name.operators.includes("$like"));
  assert.ok(partial.warnings.some((m) => m.includes('"strings"') && m.includes("§2.1")));

  // Issue #11's second shape: a store that cannot implement $exists at all.
  // core is mandatory, so what is left is not a conforming implementation, and
  // the document must not say otherwise.
  const noCore = generateFilterSchema(pet, { dropOperators: ["$exists"] });
  assert.ok(!noCore.capabilities.profiles.includes("core"));
  assert.ok(noCore.warnings.some((m) => m.includes("not a conforming implementation")));
});

test("--no-shorthand gives scalars the object-only form", () => {
  const { schema } = generateFilterSchema(pet, { shorthand: false });
  assert.deepEqual(schema.properties.status, { $ref: "#/$defs/C_status" });
  assert.ok(!("anyOf" in schema.properties.status));
  // The root description teaches the rules a reader would otherwise get wrong.
  // Leaving the shorthand among them would advertise a form this schema rejects.
  assert.ok(!schema.description.includes("bare scalar"));
  assert.ok(generateFilterSchema(pet, {}).schema.description.includes("bare scalar"));

  const check = makeAjv().compile(schema);
  assert.equal(check({ status: "available" }), false, "the shorthand should be gone");
  assert.ok(check({ status: { $eq: "available" } }), errs(check));
});

test("--max-filter-depth bounds how deep the logical operators nest", () => {
  // Issue #11's third shape: a provider compiling to a flat conjunctive index
  // wants one AND level and no more. JSON Schema cannot count how deep an
  // instance already is, so the filter is unrolled into a chain of levels —
  // depth 1 being the flat filter that offers no logical operators at all.
  const flat = generateFilterSchema(pet, { maxFilterDepth: 1 }).schema;
  assert.deepEqual(Object.keys(flat.properties).filter((k) => k.startsWith("$")), []);

  const { schema } = generateFilterSchema(pet, { maxFilterDepth: 2 });
  const deeper = schema.$defs[schema.properties.$and.items.$ref.replace("#/$defs/", "")];
  assert.deepEqual(Object.keys(deeper.properties).filter((k) => k.startsWith("$")), []);
  assert.ok("status" in deeper.properties, "every level offers the same fields");
  assert.equal(deeper.properties.status.$ref, schema.properties.status.$ref, "levels share the operand defs");

  const check = makeAjv().compile(schema);
  assert.ok(check({ $and: [{ status: "available" }, { name: { $like: "F%" } }] }), errs(check));
  assert.equal(check({ $and: [{ $and: [{ status: "available" }] }] }), false, "two AND levels");
  assert.equal(check({ $and: [{ $or: [{ status: "available" }] }] }), false, "OR inside AND");
  // Field-level $not is self-referential too, so it is bounded to a single
  // application: under Kleene logic ¬¬X ≡ X even for UNKNOWN.
  assert.ok(check({ status: { $not: { $eq: "available" } } }), errs(check));
  assert.equal(check({ status: { $not: { $not: { $eq: "available" } } } }), false, "negated negation");

  assert.throws(() => generateFilterSchema(pet, { maxFilterDepth: 0 }), /--max-filter-depth/);
});

test("--include reaches every level of a capped filter", () => {
  // The levels repeat the root's field properties, so pruning only the root left
  // every excluded path reachable one $and down.
  const { schema } = generateFilterSchema(pet, { include: ["status"], maxFilterDepth: 2 });
  const deeper = schema.$defs[schema.properties.$and.items.$ref.replace("#/$defs/", "")];
  assert.deepEqual(Object.keys(deeper.properties), ["status"]);

  const check = makeAjv().compile(schema);
  assert.ok(check({ $and: [{ status: "available" }] }), errs(check));
  assert.equal(check({ $and: [{ name: "Fido" }] }), false, "name is not in --include");
});

test("the default is still one self-referential filter, not a chain", () => {
  // The chain is what --max-filter-depth costs; nobody who did not ask for a
  // bound should pay it.
  assert.equal(generated.properties.$and.items.$ref, "#");
  assert.ok(!Object.keys(generated.$defs).some((name) => name.includes("_depth_")));
});

test("--limits publishes the provider's real bounds", () => {
  // SPEC §7's numbers were emitted unconditionally, so every generated document
  // claimed them whether or not they were true.
  const { capabilities: caps } = generateFilterSchema(pet, { limits: { maxClauses: 40 } });
  assert.deepEqual(caps.limits, { maxDepth: 10, maxClauses: 40, maxSetLength: 1000 });

  assert.throws(() => generateFilterSchema(pet, { limits: { maxNesting: 4 } }), /unknown limit "maxNesting"/);
  assert.throws(() => generateFilterSchema(pet, { limits: { maxDepth: 0 } }), /must be a positive integer/);

  // A schema that refuses nesting past n and a document claiming a deeper
  // maxDepth would contradict each other, so the enforced bound is published.
  const capped = generateFilterSchema(pet, { maxFilterDepth: 3 });
  assert.equal(capped.capabilities.limits.maxDepth, 3);
  const both = generateFilterSchema(pet, { maxFilterDepth: 3, limits: { maxDepth: 9 } });
  assert.equal(both.capabilities.limits.maxDepth, 9);
  assert.ok(both.warnings.some((m) => m.includes("maxDepth")));
});

test("a config file is the selection, and an explicit flag still beats it", () => {
  // The config file is what a provider checks in beside the resource schema and
  // regenerates from, so its paths are relative to itself rather than to
  // whatever directory the command happened to run in.
  const dir = mkdtempSync(join(tmpdir(), "open-predicate-config-"));
  writeFileSync(join(dir, "pet.schema.json"), readFileSync(join(repo, "examples", "pet.schema.json")));
  const file = join(dir, "open-predicate.config.json");
  writeFileSync(file, JSON.stringify({
    resource: "pet.schema.json",
    profiles: ["core", "strings"],
    dropOperators: ["$contains"],
    shorthand: false,
    limits: { maxDepth: 4 },
    out: "pet.filter.json",
  }));

  const fromConfig = resolveOptions({ config: file }, [], repo);
  assert.equal(fromConfig.source, join(dir, "pet.schema.json"));
  assert.equal(fromConfig.out, join(dir, "pet.filter.json"));
  assert.deepEqual(fromConfig.options.dropOperators, ["$contains"]);
  assert.equal(fromConfig.options.shorthand, false);
  assert.deepEqual(fromConfig.options.limits, { maxDepth: 4 });

  // A one-off refinement on top of a checked-in config is the point of having
  // both, so the flag wins.
  const overridden = resolveOptions({ config: file, profiles: "core", include: "status,name" }, [], repo);
  assert.deepEqual(overridden.options.profiles, ["core"]);
  assert.deepEqual(overridden.options.include, ["status", "name"]);
  assert.deepEqual(overridden.options.dropOperators, ["$contains"], "the config still supplies the rest");

  // The schema the config describes is generated without further arguments.
  const { schema } = generateFilterSchema(
    JSON.parse(readFileSync(fromConfig.source, "utf8")),
    fromConfig.options,
  );
  assert.ok(!JSON.stringify(schema).includes('"$contains"'));
  assert.deepEqual(schema.properties.status, { $ref: "#/$defs/C_status" });
});

test("a misspelled config key is refused rather than ignored", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-predicate-config-"));
  const file = join(dir, "open-predicate.config.json");
  writeFileSync(file, JSON.stringify({ profiles: ["core"], dropOperator: ["$exists"] }));
  assert.throws(() => resolveOptions({ config: file }, [], repo), /unknown key "dropOperator"/);

  writeFileSync(file, JSON.stringify(["core"]));
  assert.throws(() => resolveOptions({ config: file }, [], repo), /must contain a JSON object/);
});

test("--max-depth refuses a value that is not a number", () => {
  // It was coerced with Number() and never checked, so --max-depth deep became
  // NaN and silently stopped the walk at the first nested object.
  assert.throws(() => resolveOptions({ "max-depth": "deep" }, ["x.json"], repo), /--max-depth must be an integer/);
  assert.equal(resolveOptions({ "max-depth": "0" }, ["x.json"], repo).options.maxDepth, 0);
});

test("the CLI runs when invoked through a symlink, as npm installs a bin", () => {
  // npm installs `bin` as a symlink, so argv[1] is node_modules/.bin/<name>
  // while import.meta.url is the file it points at. The entry guard compared
  // the two directly, so it was false for every `npx` and every global install:
  // the CLI exited 0 having printed nothing, while `node tools/…` worked and
  // hid it. Run the real generator through a symlink and require output.
  const dir = mkdtempSync(join(tmpdir(), "open-predicate-bin-"));
  const link = join(dir, "open-predicate-generate");
  symlinkSync(join(repo, "tools", "generate-filter-schema.mjs"), link);

  const out = execFileSync(process.execPath, [link, "--help"], { encoding: "utf8" });
  assert.match(out, /derive a per-resource filter schema/);

  // And it still must not run on import, which is what the guard is there for.
  const quiet = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(link).href)});`],
    { encoding: "utf8" },
  );
  assert.equal(quiet, "");
});
