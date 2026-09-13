#!/usr/bin/env node
/**
 * generate-filter-schema.mjs — derive a per-resource filter schema from a
 * resource's JSON Schema.
 *
 * The published grammar (query-language-schema.json) shares one `Constraint`
 * definition across every field, so it can say that `{"status": "Available"}`
 * is well-formed but not that "Available" is outside `status`'s domain. That
 * gap is why SPEC.md §2.2 exists: the domains have to be published somewhere,
 * and the grammar is not able to carry them.
 *
 * A *generated* schema can. Given the resource's own JSON Schema, every
 * queryable path is known, along with its type, format and value set — so each
 * path gets its own constraint subschema, carrying only the operators that
 * apply to it and only the operands it can meaningfully take. The three
 * valid-but-wrong filters in README §"Exposing search to an agent" all become
 * validation failures instead of empty result sets.
 *
 * Operator titles and descriptions are copied from the published grammar rather
 * than restated here, so the prose an agent reads stays in one place.
 *
 * Usage:
 *   jql-generate <resource-schema.json> [options]
 *   jql-generate --config <jql.config.json>
 *
 * `jql-generate` is the installed name; from a clone it is
 * `node tools/generate-filter-schema.mjs`, with the same arguments.
 *
 * What the schema describes:
 *   --id <uri>              $id for the generated schema (recommended)
 *   --title <text>          title for the generated schema
 *   --pointer <json-ptr>    subschema of the input file to treat as the resource
 *   --max-depth <n>         how far to descend into nested objects (default 3)
 *   --include <list>        comma-separated paths; omit for "everything found"
 *   --exclude <list>        comma-separated paths or path prefixes ending in *
 *
 * What the endpoint can actually serve — the filter schema is a narrowing, so
 * anything declined here is rejected by validation instead of at runtime:
 *   --profiles <list>       comma-separated; default core,strings,ranges,collections
 *   --operators <list>      exactly these operators, intersected with --profiles
 *   --drop-operators <list> everything --profiles implies, minus these
 *   --no-shorthand          drop the bare-scalar form; every constraint takes
 *                           the object form
 *   --max-filter-depth <n>  the deepest filter the schema accepts. 1 is a flat
 *                           filter with no logical operators at all, 2 permits
 *                           one $and/$or/$nor/$not level. Unbounded by default
 *   --limits <json|@file>   maxDepth, maxClauses and maxSetLength for the
 *                           capability document, merged over the defaults
 *
 * Output:
 *   --descriptions <mode>   all | brief | none. Default brief: the operators
 *                           whose semantics surprise people keep their prose,
 *                           the self-evident ones keep only a title.
 *   --out <file>            write the schema here instead of stdout
 *   --capabilities <file>   also write a SPEC.md §2.2 capability document
 *   --grammar <file>        path to query-language-schema.json
 *   --config <file>         read these options from JSON, using the camelCase
 *                           names of the JS API plus "resource", "out" and
 *                           "capabilities". Relative paths in it resolve
 *                           against its own directory, and an explicit flag
 *                           always beats it. This is the file to check in.
 *   --quiet                 suppress warnings on stderr
 *
 * A property may also opt out or override in the resource schema itself:
 *   "x-jql": false                        — not queryable
 *   "x-jql": { "queryable": false }       — same
 *   "x-jql": { "operators": ["$eq"] }     — exactly these operators
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_GRAMMAR = join(here, "..", "query-language-schema.json");
const DEFAULT_PROFILES = ["core", "strings", "ranges", "collections"];
/** SPEC §7's RECOMMENDED defaults, published through the capability document (§2.2). */
const DEFAULT_LIMITS = { maxDepth: 10, maxClauses: 100, maxSetLength: 1000 };

/** Formats whose values are opaque tokens: substring matching on them is noise. */
const OPAQUE_FORMATS = new Set(["uuid", "uri", "iri", "email", "ipv4", "ipv6", "duration"]);
/** Formats whose lexicographic order coincides with their natural order (SPEC §5.2). */
const ORDERED_FORMATS = new Set(["date", "date-time", "time"]);
/**
 * Operators whose description earns its place next to every field: each one is
 * a rule a reader would otherwise get wrong. The rest carry their title only,
 * because repeating "Field equals the operand" once per path is pure tokens in
 * an MCP tool definition. `--descriptions all` restores them.
 */
const SURPRISING = new Set([
  "$and", "$or", "$nor", "$not",
  "$in", "$nin", "$exists", "$isNull", "$type",
  "$like", "$ilike", "$contains", "$regex", "$flags", "$search",
  "$between", "$hasAll", "$size", "$some", "$every", "$unknownAs",
]);

/** Value-domain keywords worth carrying onto an equality operand. */
const DOMAIN_KEYWORDS = [
  "enum", "const", "format", "pattern", "minLength", "maxLength",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
];

// ---------------------------------------------------------------------------
// $ref resolution and allOf flattening
// ---------------------------------------------------------------------------

function jsonPointer(root, pointer) {
  if (pointer === "" || pointer === "#") return root;
  const parts = pointer.replace(/^#/, "").split("/").slice(1);
  let node = root;
  for (const raw of parts) {
    const key = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
    if (node === undefined || node === null) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * Follows local $refs to a concrete node. `trail` accumulates the pointers
 * crossed on this branch so a recursive schema (Pet.friends -> Pet) terminates
 * rather than looping: a ref already on the trail resolves to null and the
 * caller drops that branch.
 */
function makeDeref(root) {
  return function deref(node, trail) {
    let cur = node;
    for (let hops = 0; cur && typeof cur === "object" && typeof cur.$ref === "string"; hops++) {
      const ref = cur.$ref;
      if (!ref.startsWith("#")) {
        throw new Error(`only local $ref is supported; found "${ref}". Bundle the schema first.`);
      }
      if (hops > 32) throw new Error(`$ref chain too long at "${ref}"`);
      if (trail?.has(ref)) return null;
      trail?.add(ref);
      const target = jsonPointer(root, ref);
      if (target === undefined) throw new Error(`unresolvable $ref: "${ref}"`);
      cur = target;
    }
    return cur;
  };
}

/** Shallow-merges allOf branches so a composed resource schema still yields fields. */
function flatten(node, deref, trail) {
  const resolved = deref(node, trail);
  if (!resolved || typeof resolved !== "object") return resolved;
  if (!Array.isArray(resolved.allOf)) return resolved;

  const merged = { ...resolved };
  delete merged.allOf;
  for (const branch of resolved.allOf) {
    const b = flatten(branch, deref, new Set(trail));
    if (!b || typeof b !== "object") continue;
    merged.properties = { ...(b.properties ?? {}), ...(merged.properties ?? {}) };
    if (b.required) merged.required = [...new Set([...(b.required ?? []), ...(merged.required ?? [])])];
    for (const k of ["type", "items", "description", "title", ...DOMAIN_KEYWORDS]) {
      if (merged[k] === undefined && b[k] !== undefined) merged[k] = b[k];
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Type inspection
// ---------------------------------------------------------------------------

function typesOf(schema) {
  if (!schema || typeof schema !== "object") return [];
  if (typeof schema.type === "string") return [schema.type];
  if (Array.isArray(schema.type)) return [...schema.type];
  // No explicit "type" — infer from whatever else is present.
  const inferred = new Set();
  for (const value of [].concat(schema.const ?? [], schema.enum ?? [])) {
    inferred.add(value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "object" ? "object" : typeof value);
  }
  if (schema.properties || schema.additionalProperties) inferred.add("object");
  if (schema.items || schema.prefixItems) inferred.add("array");
  return [...inferred];
}

/** The consts of a closed domain, whether written as `enum` or as a union of `const`s. */
function domainValues(schema) {
  if (Array.isArray(schema?.enum)) return schema.enum;
  if (schema?.const !== undefined) return [schema.const];
  const union = schema?.oneOf ?? schema?.anyOf;
  if (Array.isArray(union) && union.length && union.every((b) => b && b.const !== undefined)) {
    return union.map((b) => b.const);
  }
  return null;
}

const SCALARS = new Set(["string", "number", "integer", "boolean"]);

function classify(schema) {
  const types = typesOf(schema);
  const nullable = types.includes("null");
  const nonNull = types.filter((t) => t !== "null");
  if (nonNull.length === 0) return { kind: "unknown", nullable, types: nonNull };
  if (nonNull.length === 1 && nonNull[0] === "array") return { kind: "array", nullable, types: nonNull };
  if (nonNull.length === 1 && nonNull[0] === "object") return { kind: "object", nullable, types: nonNull };
  if (nonNull.every((t) => SCALARS.has(t))) return { kind: "scalar", nullable, types: nonNull };
  return { kind: "mixed", nullable, types: nonNull };
}

// ---------------------------------------------------------------------------
// Field paths (SPEC §3.2, §3.3)
// ---------------------------------------------------------------------------

function escapeKey(key) {
  const escaped = key.replace(/([.[\]\\])/g, "\\$1");
  return escaped.startsWith("$") ? `$${escaped}` : escaped;
}

function globToRegExp(glob) {
  const body = glob.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}$`);
}

// ---------------------------------------------------------------------------
// Field collection
// ---------------------------------------------------------------------------

/**
 * Walks one object schema and returns the queryable paths beneath it. Nested
 * objects contribute dotted paths within the *same* filter; arrays stop the
 * descent and are addressed through the $some/$every quantifiers instead, which
 * say which quantifier is meant instead of leaving it to a path shape (SPEC §5.8).
 */
function collectFields(node, ctx, state) {
  const out = [];
  walk(node, "", true, state.depth, new Set(state.trail));

  function walk(schemaNode, prefix, alwaysPresent, depth, trail) {
    const schema = flatten(schemaNode, ctx.deref, trail);
    if (!schema || typeof schema !== "object" || !schema.properties) return;
    const required = new Set(schema.required ?? []);

    for (const [name, rawProp] of Object.entries(schema.properties)) {
      const branchTrail = new Set(trail);
      const prop = flatten(rawProp, ctx.deref, branchTrail);
      if (!prop || typeof prop !== "object") continue;

      const ext = rawProp["x-jql"] ?? prop["x-jql"];
      if (ext === false || ext?.queryable === false) continue;

      const path = prefix + escapeKey(name);
      if (ctx.opts.exclude.some((rx) => rx.test(path))) continue;

      const present = alwaysPresent && required.has(name);
      const info = classify(prop);

      if (info.kind === "unknown") {
        ctx.warn(`skipped "${path}": no discoverable type. Add "type", or "x-jql": {"operators": [...]}.`);
        continue;
      }

      if (info.kind === "object") {
        // The object itself is queryable only for presence; its members carry
        // the real predicates.
        if (!present) out.push({ path, schema: prop, info, present, ext, kind: "object" });
        if (depth + 1 <= ctx.opts.maxDepth) {
          walk(prop, `${path}.`, present, depth + 1, branchTrail);
        } else {
          ctx.warn(`stopped at "${path}": --max-depth ${ctx.opts.maxDepth} reached.`);
        }
        continue;
      }

      if (info.kind === "array") {
        const items = flatten(prop.items ?? {}, ctx.deref, branchTrail);
        const itemInfo = items ? classify(items) : { kind: "unknown" };
        out.push({ path, schema: prop, info, present, ext, kind: "array", items, itemInfo, trail: branchTrail, depth });
        continue;
      }

      out.push({ path, schema: prop, info, present, ext, kind: info.kind });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Operator selection
// ---------------------------------------------------------------------------

function operatorsFor(field, ctx) {
  if (Array.isArray(field.ext?.operators)) {
    return field.ext.operators.filter((op) => ctx.enabled.has(op));
  }

  const ops = [];
  const push = (...names) => { for (const n of names) if (ctx.enabled.has(n)) ops.push(n); };
  const { info, schema, kind } = field;
  const format = schema.format;
  const closed = domainValues(schema) !== null;

  if (kind === "object") {
    push("$exists");
    if (info.nullable) push("$isNull");
    pushUnknownAs(push, field, info);
    return ops;
  }

  if (kind === "array") {
    // An element type we could not resolve — an untyped `items`, or a cycle the
    // walk cut — leaves nothing to type an operand against. Length and presence
    // are all that can be offered honestly.
    if (!field.itemInfo || field.itemInfo.kind === "unknown") {
      ctx.warn(`"${field.path}": element type unresolved; only $size and presence are queryable.`);
      push("$size");
      if (!field.present) push("$exists");
      if (info.nullable) push("$isNull");
      push("$not");
      pushUnknownAs(push, field, info);
      return ops;
    }
    push("$eq", "$ne");
    if (field.itemInfo?.kind === "object" || field.itemInfo?.kind === "scalar") push("$some", "$every");
    if (field.itemInfo.kind === "scalar") push("$hasAll");
    push("$size");
    if (!field.present) push("$exists");
    if (info.nullable) push("$isNull");
    push("$not");
    pushUnknownAs(push, field, info);
    return ops;
  }

  const isString = info.types.includes("string");
  const isNumeric = info.types.some((t) => t === "number" || t === "integer");
  const isBoolean = info.types.length === 1 && info.types[0] === "boolean";

  push("$eq", "$ne");
  // $in over a two-valued domain says nothing $eq does not.
  if (!isBoolean) push("$in", "$nin");

  const ordered = isNumeric || (isString && ORDERED_FORMATS.has(format));
  if (ordered) {
    push("$gt", "$gte", "$lt", "$lte");
    push("$between", "$nbetween");
  }

  // Pattern matching is meaningful on free text only: not on a closed domain,
  // where the accepted values are already enumerated, and not on an opaque
  // token like a UUID.
  if (isString && !closed && !OPAQUE_FORMATS.has(format) && !ORDERED_FORMATS.has(format)) {
    push("$like", "$nlike", "$ilike", "$nilike", "$startsWith", "$endsWith", "$contains");
    push("$regex", "$flags");
    push("$search");
  }

  // $type only earns its place where the type is genuinely a union.
  if (info.types.length > 1) push("$type");
  if (!field.present) push("$exists");
  if (info.nullable) push("$isNull");
  push("$not");
  pushUnknownAs(push, field, info);
  return ops;
}

/**
 * $unknownAs only earns its place where UNKNOWN is reachable. A property that is
 * required all the way up and cannot hold null never resolves to nothing, and
 * the generated operand schemas make a type mismatch a validation error rather
 * than an UNKNOWN — so on those fields the modifier would be a constant, exactly
 * as $exists and $isNull are.
 */
function pushUnknownAs(push, field, info) {
  if (!field.present || info.nullable) push("$unknownAs");
}

// ---------------------------------------------------------------------------
// Operand schemas
// ---------------------------------------------------------------------------

/**
 * The operand schema for the equality family: the field's own value domain.
 * Carrying `enum`, `pattern` and the numeric bounds is what turns
 * {"status": "Available"} from an empty result set into a 400.
 */
function strictValue(schema, info) {
  const value = {};
  const known = info?.types ?? [];
  const types = info?.nullable ? [...known, "null"] : [...known];
  const consts = domainValues(schema);
  const union = schema.oneOf ?? schema.anyOf;

  if (consts && Array.isArray(union) && union.every((b) => b?.const !== undefined) && union.some((b) => b.description)) {
    // Per-value prose only survives as a union of consts; an enum has nowhere
    // to put it. README §"Exposing search to an agent", step 2.
    if (types.length) value.type = types.length === 1 ? types[0] : types;
    value.anyOf = union.map((b) => ({ const: b.const, ...(b.description ? { description: b.description } : {}) }));
    if (info.nullable) value.anyOf.push({ const: null });
    return value;
  }

  if (types.length) value.type = types.length === 1 ? types[0] : types;
  for (const k of DOMAIN_KEYWORDS) {
    if (schema[k] !== undefined) value[k] = schema[k];
  }
  if (consts && info?.nullable && Array.isArray(value.enum) && !value.enum.includes(null)) {
    value.enum = [...value.enum, null];
  }
  return value;
}

/**
 * The operand schema for the ordering family. Deliberately looser than
 * `strictValue`: `{"$gt": 0}` against a field whose minimum is 1 is a
 * perfectly sensible predicate, so the bounds must not be carried across.
 */
function looseValue(schema, info) {
  const value = { type: info.types.length === 1 ? info.types[0] : info.types };
  if (schema.format && ORDERED_FORMATS.has(schema.format)) value.format = schema.format;
  return value;
}

function setOf(itemsRef) {
  return { type: "array", minItems: 1, uniqueItems: true, items: itemsRef };
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

function sanitize(text) {
  return text
    .replace(/\[\*\]/g, "_elem")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "field";
}

function defName(ctx, prefix, hint) {
  const base = `${prefix}${sanitize(hint)}`;
  let name = base;
  for (let n = 2; ctx.defs[name] !== undefined || ctx.reserved.has(name); n++) name = `${base}${n}`;
  ctx.reserved.add(name);
  return name;
}

/**
 * Copies the operator's own title and description out of the published grammar,
 * so the prose an agent reads lives in exactly one place. `from` picks the
 * right definition for the two operators that exist at both levels: $not means
 * something different inside a Filter than inside a constraint object.
 */
function annotate(ctx, op, schema, from = "constraint") {
  const table = from === "filter" ? ctx.grammar.$defs.Filter.properties : ctx.grammar.$defs.ConstraintObject.properties;
  const source = table[op] ?? ctx.grammar.$defs.ConstraintObject.properties[op] ?? ctx.grammar.$defs.Filter.properties[op];
  const { title, description } = source ?? {};
  const keep = ctx.opts.descriptions === "all" || (ctx.opts.descriptions === "brief" && SURPRISING.has(op));
  return {
    ...(title ? { title } : {}),
    ...(keep && description ? { description } : {}),
    ...schema,
  };
}

function emitSizeDef(ctx) {
  if (!ctx.defs.Size) {
    ctx.reserved.add("Size");
    ctx.defs.Size = structuredClone(ctx.grammar.$defs.SizeConstraint);
  }
  return { $ref: "#/$defs/Size" };
}

/**
 * Carries the published constraint object's dependency keywords over to a
 * generated one, for the triggers whose operator survived: $flags needs $regex
 * beside it, and $unknownAs needs something to modify.
 *
 * These rules are part of what the grammar rejects, so a generated schema that
 * drops one is *wider* than the grammar there — which is the one thing a
 * generated schema may never be (README §"Narrowing only"). Reading them off
 * the grammar rather than restating them here means a rule added to
 * $defs/ConstraintObject reaches generated schemas with the version that
 * introduced it.
 */
function dependencyRules(ctx, props) {
  const source = ctx.grammar.$defs.ConstraintObject;
  // The rule is carried; the $comment justifying it is not. That prose is
  // written for someone reading the grammar, and here it would be one copy per
  // field, charged by the token to whoever inlines this in a tool definition.
  const constraining = ({ $comment, ...rest }) => structuredClone(rest);
  const rules = {};
  for (const keyword of ["dependentSchemas", "dependentRequired"]) {
    const kept = {};
    for (const [trigger, rule] of Object.entries(source[keyword] ?? {})) {
      if (trigger in props) kept[trigger] = Array.isArray(rule) ? [...rule] : constraining(rule);
    }
    if (Object.keys(kept).length > 0) rules[keyword] = kept;
  }
  return rules;
}

/** Builds the constraint-object subschema for one field, and registers it. */
function emitConstraint(ctx, field, prefix) {
  const ops = operatorsFor(field, ctx);
  if (ops.length === 0) return null;
  // A bounded $not points at a copy of this constraint object with $not removed,
  // so it needs at least one other operator to negate.
  if (ctx.opts.maxFilterDepth !== undefined && ops.length === 1 && ops[0] === "$not") return null;

  const name = defName(ctx, `${prefix}C_`, field.nameHint ?? field.path);
  const props = {};

  const hint = field.nameHint ?? field.path;
  const valueRef = () => {
    if (!field.valueDef) {
      field.valueDef = defName(ctx, `${prefix}V_`, hint);
      ctx.defs[field.valueDef] = strictValue(field.schema, field.info);
    }
    return { $ref: `#/$defs/${field.valueDef}` };
  };
  const orderedRef = () => {
    if (!field.orderedDef) {
      field.orderedDef = defName(ctx, `${prefix}O_`, hint);
      ctx.defs[field.orderedDef] = looseValue(field.schema, field.info);
    }
    return { $ref: `#/$defs/${field.orderedDef}` };
  };
  // Unbounded, $not negates this very constraint object, so {"$not": {"$not": …}}
  // nests forever. Where a depth is set that has to stop somewhere, and one
  // level is the natural place: under Kleene logic ¬¬X ≡ X even for UNKNOWN, so
  // a negated negation says nothing the plain constraint does not.
  let negName = null;
  const notRef = () => {
    if (ctx.opts.maxFilterDepth === undefined) return `#/$defs/${name}`;
    negName ??= defName(ctx, `${prefix}N_`, hint);
    return `#/$defs/${negName}`;
  };
  const itemRef = () => {
    if (!field.itemDef) {
      field.itemDef = defName(ctx, `${prefix}I_`, hint);
      ctx.defs[field.itemDef] = strictValue(field.items ?? {}, field.itemInfo);
    }
    return { $ref: `#/$defs/${field.itemDef}` };
  };

  for (const op of ops) {
    switch (op) {
      case "$eq": case "$ne":
        props[op] = annotate(ctx, op, field.kind === "array"
          ? { type: "array", items: itemRef() }
          : valueRef());
        break;
      case "$in": case "$nin":
        props[op] = annotate(ctx, op, setOf(valueRef()));
        break;
      case "$gt": case "$gte": case "$lt": case "$lte":
        props[op] = annotate(ctx, op, orderedRef());
        break;
      case "$between": case "$nbetween":
        props[op] = annotate(ctx, op, { type: "array", minItems: 2, maxItems: 2, items: orderedRef() });
        break;
      case "$hasAll":
        props[op] = annotate(ctx, op, setOf(itemRef()));
        break;
      case "$size":
        props[op] = annotate(ctx, op, emitSizeDef(ctx));
        break;
      case "$some": case "$every": {
        // Both quantifiers take the same element condition, so the subschema is
        // emitted once and referenced twice.
        field.elementTarget ??= emitQuantifierTarget(ctx, field, prefix);
        if (field.elementTarget) props[op] = annotate(ctx, op, field.elementTarget);
        break;
      }
      case "$not":
        props[op] = annotate(ctx, op, { $ref: notRef() });
        break;
      case "$flags":
        props[op] = annotate(ctx, op, { type: "string", pattern: "^[ims]{0,3}$" });
        break;
      default: {
        // Everything left takes the operand shape the grammar already gives it:
        // $like and friends, $regex, $search, $exists, $isNull, $type.
        const base = ctx.grammar.$defs.ConstraintObject.properties[op];
        const { title, description, $ref, ...shape } = base ?? {};
        props[op] = annotate(ctx, op, shape);
      }
    }
  }

  if (negName) {
    // The same constraint object minus $not, so one negation is expressible and
    // two are not. Reachable only through $not, whose own description explains
    // negation, so the field's prose is not repeated into it.
    const { $not: dropped, ...rest } = props;
    ctx.defs[negName] = {
      title: `${field.path}, negated`,
      type: "object",
      minProperties: 1,
      ...dependencyRules(ctx, rest),
      properties: rest,
      additionalProperties: false,
    };
  }

  const constraint = {
    title: field.path,
    ...(field.schema.description ? { description: field.schema.description } : {}),
    type: "object",
    minProperties: 1,
    ...dependencyRules(ctx, props),
    properties: props,
    additionalProperties: false,
  };

  ctx.defs[name] = constraint;
  field.constraintDef = name;
  field.operators = ops;

  // Scalars keep the shorthand: {"status": "open"} is {"status": {"$eq": "open"}}.
  // --no-shorthand gives them the object-only form arrays and objects already
  // have, which costs a provider nothing to accept and buys a validator that
  // reports where a constraint went wrong instead of an anyOf that failed.
  if (field.kind === "scalar" && ctx.opts.shorthand) {
    return { anyOf: [valueRef(), { $ref: `#/$defs/${name}` }] };
  }
  return { $ref: `#/$defs/${name}` };
}

function emitQuantifierTarget(ctx, field, prefix) {
  if (field.itemInfo?.kind === "object") {
    if (field.depth + 1 > ctx.opts.maxDepth) {
      ctx.warn(`"${field.path}": --max-depth reached, $some and $every omitted.`);
      return null;
    }
    const name = defName(ctx, `${prefix}F_`, `${field.path}_elem`);
    const filter = emitFilter(ctx, field.items, name, {
      depth: field.depth + 1,
      trail: field.trail ?? new Set(),
      selfRef: `#/$defs/${name}`,
    });
    if (!filter) return null;
    return { $ref: `#/$defs/${name}` };
  }
  if (field.itemInfo?.kind === "scalar") {
    // An array of scalars has no member paths, so the element condition is a
    // constraint object over the element value itself (SPEC §5.8).
    const element = {
      path: `${field.path} element`,
      nameHint: `${field.path}_elem`,
      schema: field.items ?? {},
      info: field.itemInfo,
      present: true,
      kind: "scalar",
    };
    const ref = emitConstraint(ctx, element, prefix);
    // The quantifiers take the object form only; the scalar shorthand is not
    // part of their operand grammar.
    return element.constraintDef ? { $ref: `#/$defs/${element.constraintDef}` } : ref;
  }
  return null;
}

/**
 * Emits a Filter over one object schema: logical operators plus one property
 * per queryable path. `additionalProperties: false` over an explicit property
 * list is what makes an unknown field a validation error rather than a runtime
 * `unknown-field` error.
 */
function emitFilter(ctx, node, name, state) {
  if (name !== "__root__") ctx.reserved.add(name);
  const fields = collectFields(node, ctx, state);
  if (fields.length === 0) {
    ctx.warn(`no queryable fields found${name === "__root__" ? "" : ` for ${name}`}.`);
    return null;
  }

  const prefix = name === "__root__" ? "" : `${sanitize(name)}_`;
  const fieldProps = {};
  const emitted = [];
  for (const field of fields) {
    const ref = emitConstraint(ctx, field, prefix);
    if (!ref) continue;
    fieldProps[field.path] = ref;
    emitted.push(field);
  }
  if (emitted.length === 0) {
    // Logical operators over no field predicates is an infinite regress with no
    // base case: every instance of it is unsatisfiable.
    ctx.warn(`no constraints could be emitted${name === "__root__" ? "" : ` for ${name}`}.`);
    return null;
  }

  // Unbounded nesting is the single self-referential object it has always been.
  // A bounded one has to be a chain, because JSON Schema cannot count how deep
  // an instance already is: level i offers the logical operators over level
  // i+1, and the last level does not offer them at all. Every level shares the
  // field properties, so the cost is n copies of a map of $refs, not n copies
  // of the operand schemas.
  const depth = ctx.opts.maxFilterDepth ?? 1;
  const hint = name === "__root__" ? "Filter" : name;
  const deeper = [];
  for (let i = 2; i <= depth; i++) deeper.push(defName(ctx, "", `${hint}_depth_${i}`));

  const level = (i) => {
    const properties = {};
    const next =
      ctx.opts.maxFilterDepth === undefined ? (state.selfRef ?? "#")
      : i < depth ? `#/$defs/${deeper[i - 1]}`
      : null;
    if (next) {
      for (const op of ["$and", "$or", "$nor"]) {
        if (!ctx.enabled.has(op)) continue;
        properties[op] = annotate(ctx, op, { type: "array", minItems: 1, items: { $ref: next } }, "filter");
      }
      if (ctx.enabled.has("$not")) properties.$not = annotate(ctx, "$not", { $ref: next }, "filter");
    }
    return {
      type: "object",
      minProperties: 1,
      properties: { ...properties, ...fieldProps },
      additionalProperties: false,
    };
  };

  for (let i = 2; i <= depth; i++) ctx.defs[deeper[i - 2]] = level(i);
  const filter = level(1);

  if (name === "__root__") {
    ctx.rootFilter = filter;
    ctx.rootFields = emitted;
    // The deeper levels repeat the root's field properties, so --include has to
    // reach them too — otherwise a path pruned from the root walks back in
    // under an $and.
    ctx.rootLevels = deeper.map((level) => ctx.defs[level]);
  } else {
    ctx.defs[name] = filter;
  }
  return filter;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const SHORTHAND_RULE =
  "A bare scalar is equality: {\"status\": \"open\"} is {\"status\": {\"$eq\": \"open\"}}.";

const SILENT_RULES = [
  "Sibling members are combined with implicit AND, at every level.",
  SHORTHAND_RULE,
  "Comparisons use three-valued logic: $ne and $not do NOT match records where the field is null or absent. To include those records, add \"$unknownAs\": true to the same constraint.",
  "$in compares the whole field value; it is not array membership. To say something about the elements of an array, quantify: {\"tags\": {\"$some\": {\"$in\": [\"a\"]}}}.",
];

export function generateFilterSchema(resource, options = {}) {
  const ctx = prepare(resource, options);
  emitFilter(ctx, ctx.resource, "__root__", { depth: 0, trail: new Set() });
  if (!ctx.rootFilter) throw new Error("no queryable fields — nothing to generate");
  if (ctx.opts.include) pruneToIncluded(ctx);

  const title = options.title ?? `${ctx.resource.title ?? "Resource"} — filter`;
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...(options.id ? { $id: options.id } : {}),
    title,
    description: [
      `A filter over ${ctx.resource.title ?? "this resource"}, in the JSON Query Language.`,
      ...SILENT_RULES.filter((rule) => ctx.opts.shorthand || rule !== SHORTHAND_RULE),
    ].join(" "),
    $comment:
      `Generated by tools/generate-filter-schema.mjs from ${ctx.resource.$id ?? options.source ?? "a resource schema"} ` +
      `against ${ctx.grammar.$id}. Profiles: ${ctx.opts.profiles.join(", ")}` +
      `${ctx.opts.excluded.length ? ` (minus ${ctx.opts.excluded.join(", ")})` : ""}. Do not edit by hand.`,
    ...ctx.rootFilter,
    $defs: ctx.defs,
  };
  return { schema, capabilities: buildCapabilities(ctx, options), warnings: ctx.warnings };
}

export function generateCapabilities(resource, options = {}) {
  return generateFilterSchema(resource, options).capabilities;
}

/**
 * --include is applied after the walk rather than during it, so a nested path
 * like "shelter.city" can be named without also naming its parent.
 */
function pruneToIncluded(ctx) {
  const keep = new Set(ctx.opts.include);
  for (const filter of [ctx.rootFilter, ...ctx.rootLevels]) {
    for (const path of Object.keys(filter.properties)) {
      if (!path.startsWith("$") && !keep.has(path)) delete filter.properties[path];
    }
  }
  for (const path of ctx.opts.include) {
    if (!(path in ctx.rootFilter.properties)) ctx.warn(`--include names "${path}", which was not found.`);
  }
  ctx.rootFields = ctx.rootFields.filter((f) => keep.has(f.path));
}

function buildCapabilities(ctx, options) {
  const fields = {};
  for (const field of ctx.rootFields ?? []) {
    const entry = { operators: field.operators };
    const types = field.info.types;
    if (types.length === 1) entry.type = types[0];
    else if (types.length > 1) entry.type = types;
    if (field.schema.format) entry.format = field.schema.format;
    const values = domainValues(field.schema);
    if (values) entry.values = values;
    if (field.kind === "array" && field.items) {
      const itemValues = domainValues(field.items);
      if (itemValues) entry.itemValues = itemValues;
    }
    if (field.schema.description) entry.description = field.schema.description;
    if (field.info.nullable) entry.nullable = true;
    fields[field.path] = entry;
  }
  return {
    queryLanguage: ctx.grammar.$id,
    ...(options.id ? { filterSchema: options.id } : {}),
    profiles: ctx.opts.complete,
    fields,
    limits: ctx.opts.limits,
  };
}

/**
 * The operator set the generated schema will offer: profiles first, because
 * they are the coarse unit a server advertises, then the operator-level refinement
 * for the cases a profile boundary does not fit — a backend with LIKE but no
 * POSITION supports $like and not $contains, and a key-value store cannot
 * implement $exists at all.
 *
 * Narrowing the set is always safe: the emitted schema accepts fewer filters
 * than the grammar, never more. What it costs is the profile *claim*, which is
 * why the demotion is warned about here and reflected in the capability
 * document rather than silently kept (SPEC §2.1).
 */
function selectOperators(grammar, profiles, options, warn) {
  const byProfile = grammar["x-profiles"];
  const defined = new Set(Object.values(byProfile).flat());
  const profileOf = (op) => Object.keys(byProfile).find((p) => byProfile[p].includes(op));

  const check = (names, flag) => {
    for (const op of names) {
      if (!defined.has(op)) {
        throw new Error(`unknown operator "${op}" in ${flag}; the grammar defines ${[...defined].join(", ")}`);
      }
    }
  };
  check(options.operators ?? [], "--operators");
  check(options.dropOperators ?? [], "--drop-operators");

  let enabled = new Set(profiles.flatMap((p) => byProfile[p]));

  if (options.operators) {
    for (const op of options.operators) {
      if (!enabled.has(op)) {
        warn(`--operators names "${op}", which the "${profileOf(op)}" profile supplies; add it to --profiles for the operator to take effect.`);
      }
    }
    enabled = new Set(options.operators.filter((op) => enabled.has(op)));
  }
  for (const op of options.dropOperators ?? []) enabled.delete(op);

  // A kept operator whose dependency was dropped would be emitted with a
  // `dependentRequired` rule naming a member `additionalProperties: false`
  // forbids — present in the schema and impossible to use. The rule is read off
  // the grammar (today: $flags needs $regex) so a dependency added later is
  // handled by construction rather than by a second list here.
  for (const [trigger, requires] of Object.entries(grammar.$defs.ConstraintObject.dependentRequired ?? {})) {
    if (!enabled.has(trigger)) continue;
    const missing = requires.filter((op) => !enabled.has(op));
    if (missing.length === 0) continue;
    enabled.delete(trigger);
    warn(`"${trigger}" requires ${missing.join(", ")} beside it, so it is excluded too.`);
  }

  if (enabled.size === 0) throw new Error("the selection leaves no operators enabled");

  // Which profiles survive as *claims*. SPEC §2.1: a profile other than core is
  // implemented in full or not at all, so a profile missing an operator is no
  // longer on offer — the per-field `operators` lists carry what is.
  const requested = new Set(profiles.flatMap((p) => byProfile[p]));
  const excluded = [...requested].filter((op) => !enabled.has(op));
  const complete = profiles.filter((p) => byProfile[p].every((op) => enabled.has(op)));
  for (const p of profiles) {
    if (complete.includes(p)) continue;
    const missing = byProfile[p].filter((op) => !enabled.has(op));
    warn(
      p === "core"
        ? `the "core" profile is incomplete (${missing.join(", ")} excluded). SPEC §2.1 requires core in full, so this endpoint is not a conforming implementation; the capability document will not claim core.`
        : `profile "${p}" is not offered in full (${missing.join(", ")} excluded), so it is omitted from the capability document's profiles (SPEC §2.1).`,
    );
  }

  return { enabled, complete, excluded };
}

/**
 * SPEC §7's limits are a claim published through the capability document, not
 * something the schema enforces — except `maxDepth`, which `--max-filter-depth`
 * does enforce. Where both are given they should agree, so a disagreement is
 * worth saying out loud.
 */
function resolveLimits(options, warn) {
  const given = options.limits ?? {};
  for (const [key, value] of Object.entries(given)) {
    if (!(key in DEFAULT_LIMITS)) {
      throw new Error(`unknown limit "${key}"; --limits takes ${Object.keys(DEFAULT_LIMITS).join(", ")}`);
    }
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`limit "${key}" must be a positive integer, got ${JSON.stringify(value)}`);
    }
  }
  const limits = { ...DEFAULT_LIMITS, ...given };
  if (options.maxFilterDepth !== undefined) {
    if (given.maxDepth === undefined) limits.maxDepth = options.maxFilterDepth;
    else if (given.maxDepth !== options.maxFilterDepth) {
      warn(`--limits maxDepth is ${given.maxDepth} but the schema refuses logical nesting past ${options.maxFilterDepth}; the published limit is the looser claim.`);
    }
  }
  return limits;
}

function prepare(resource, options) {
  const grammar = options.grammar ?? JSON.parse(readFileSync(options.grammarPath ?? DEFAULT_GRAMMAR, "utf8"));
  const profiles = options.profiles ?? DEFAULT_PROFILES;

  const modes = ["all", "brief", "none"];
  if (options.descriptions && !modes.includes(options.descriptions)) {
    throw new Error(`--descriptions must be one of ${modes.join(", ")}`);
  }

  const known = Object.keys(grammar["x-profiles"]);
  for (const p of profiles) {
    if (!known.includes(p)) throw new Error(`unknown profile "${p}"; the grammar defines ${known.join(", ")}`);
  }
  if (!profiles.includes("core")) throw new Error(`the "core" profile is mandatory (SPEC §2.1)`);

  if (options.maxFilterDepth !== undefined
      && (!Number.isInteger(options.maxFilterDepth) || options.maxFilterDepth < 1)) {
    throw new Error(`--max-filter-depth must be an integer of 1 or more, got ${JSON.stringify(options.maxFilterDepth)}`);
  }

  const warnings = [];
  const warn = (m) => warnings.push(m);
  const { enabled, complete, excluded } = selectOperators(grammar, profiles, options, warn);
  const limits = resolveLimits(options, warn);

  const root = resource;
  const deref = makeDeref(root);
  const entry = options.pointer ? jsonPointer(root, options.pointer) : root;
  if (entry === undefined) throw new Error(`--pointer "${options.pointer}" does not resolve`);
  const resolved = flatten(entry, deref, new Set());

  return {
    grammar,
    deref,
    enabled,
    defs: {},
    reserved: new Set(["Size"]),
    warnings,
    warn,
    resource: resolved,
    opts: {
      profiles,
      complete,
      excluded,
      limits,
      maxDepth: options.maxDepth ?? 3,
      maxFilterDepth: options.maxFilterDepth,
      shorthand: options.shorthand !== false,
      descriptions: options.descriptions ?? "brief",
      include: options.include ?? null,
      exclude: (options.exclude ?? []).map(globToRegExp),
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const FLAGS = {
  id: { type: "string" },
  title: { type: "string" },
  profiles: { type: "string" },
  operators: { type: "string" },
  "drop-operators": { type: "string" },
  "no-shorthand": { type: "boolean" },
  "max-filter-depth": { type: "string" },
  limits: { type: "string" },
  pointer: { type: "string" },
  "max-depth": { type: "string" },
  include: { type: "string" },
  exclude: { type: "string" },
  capabilities: { type: "string" },
  descriptions: { type: "string" },
  grammar: { type: "string" },
  out: { type: "string" },
  config: { type: "string" },
  quiet: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

/** Config keys that name a file, and so resolve against the config's own directory. */
const CONFIG_PATHS = new Set(["resource", "out", "capabilities", "grammar"]);

/** The config file's vocabulary: the JS API's option names, plus where things go. */
const CONFIG_KEYS = [
  "resource", "id", "title", "profiles", "operators", "dropOperators", "shorthand",
  "maxFilterDepth", "limits", "pointer", "maxDepth", "include", "exclude",
  "descriptions", "out", "capabilities", "grammar", "quiet",
];

/**
 * Merges a config file with the command line into one options object.
 *
 * The config file is the artifact a provider checks in beside their resource
 * schema and regenerates from, so the capability selection lives in version
 * control rather than in whoever's shell history. A flag given explicitly wins
 * over it, which is what makes a one-off `--include` on top of a checked-in
 * config work.
 *
 * Exported so the merge can be tested without spawning a process.
 */
export function resolveOptions(values, positionals, cwd = process.cwd()) {
  if (positionals.length > 1) {
    throw new Error(`expected one resource schema, got ${positionals.length}: ${positionals.join(", ")}`);
  }

  let config = {};
  let base = cwd;
  if (values.config !== undefined) {
    const file = resolve(cwd, values.config);
    base = dirname(file);
    config = JSON.parse(readFileSync(file, "utf8"));
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(`${values.config} must contain a JSON object`);
    }
    // Refused rather than ignored, for the same reason parseArgs refuses an
    // unknown flag: a misspelled key is a selection that silently did not apply.
    const unknown = Object.keys(config).filter((k) => !CONFIG_KEYS.includes(k));
    if (unknown.length > 0) {
      throw new Error(
        `unknown key${unknown.length > 1 ? "s" : ""} ${unknown.map((k) => `"${k}"`).join(", ")} in ` +
        `${values.config}; it takes ${CONFIG_KEYS.join(", ")}`,
      );
    }
  }

  // Paths in a config file are relative to the config file. Paths on the command
  // line are relative to the cwd, and are left as written so that a generated
  // $comment names the schema the way the reader would.
  const configValue = (key) => (CONFIG_PATHS.has(key) ? resolve(base, config[key]) : config[key]);
  const pick = (flag, key) =>
    values[flag] !== undefined ? values[flag]
    : config[key] !== undefined ? configValue(key)
    : undefined;

  const list = (v) => {
    if (typeof v !== "string") return v;
    const items = v.split(",").map((s) => s.trim()).filter(Boolean);
    return items.length > 0 ? items : undefined;
  };
  const integer = (v, flag, min) => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) {
      throw new Error(`${flag} must be an integer of ${min} or more, got ${JSON.stringify(v)}`);
    }
    return n;
  };
  const limits = () => {
    const raw = values.limits;
    if (raw === undefined) return config.limits;
    const text = raw.startsWith("@") ? readFileSync(resolve(cwd, raw.slice(1)), "utf8") : raw;
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`--limits is not valid JSON: ${error.message}`);
    }
  };

  const source = positionals[0] ?? (config.resource !== undefined ? resolve(base, config.resource) : undefined);

  return {
    source,
    out: pick("out", "out"),
    capabilities: pick("capabilities", "capabilities"),
    quiet: values.quiet ?? config.quiet ?? false,
    options: {
      id: pick("id", "id"),
      title: pick("title", "title"),
      source,
      profiles: list(pick("profiles", "profiles")),
      operators: list(pick("operators", "operators")),
      dropOperators: list(pick("drop-operators", "dropOperators")),
      shorthand: values["no-shorthand"] ? false : config.shorthand,
      maxFilterDepth: integer(pick("max-filter-depth", "maxFilterDepth"), "--max-filter-depth", 1),
      limits: limits(),
      pointer: pick("pointer", "pointer"),
      maxDepth: integer(pick("max-depth", "maxDepth"), "--max-depth", 0),
      descriptions: pick("descriptions", "descriptions"),
      include: list(pick("include", "include")),
      exclude: list(pick("exclude", "exclude")),
      grammarPath: pick("grammar", "grammar"),
    },
  };
}

function usage() {
  // The header comment is the help text; keeping one copy avoids the usual drift.
  return readFileSync(fileURLToPath(import.meta.url), "utf8")
    .split("*/")[0]
    .replace(/^#!.*\n/, "")
    .replace(/^\/\*\*?\n?/, "")
    .replace(/^ \*\/?/gm, "")
    .replace(/^ /gm, "")
    .trimEnd();
}

function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: FLAGS });

  if (values.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  const resolved = resolveOptions(values, positionals);
  if (!resolved.source) {
    process.stdout.write(`${usage()}\n`);
    process.exit(1);
  }

  const resource = JSON.parse(readFileSync(resolved.source, "utf8"));
  const { schema, capabilities, warnings } = generateFilterSchema(resource, resolved.options);

  const json = `${JSON.stringify(schema, null, 2)}\n`;
  if (resolved.out) writeFileSync(resolved.out, json);
  else process.stdout.write(json);

  if (resolved.capabilities) {
    writeFileSync(resolved.capabilities, `${JSON.stringify(capabilities, null, 2)}\n`);
  }
  if (!resolved.quiet) {
    for (const w of warnings) process.stderr.write(`warning: ${w}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
