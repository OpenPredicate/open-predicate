import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, posix } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * The list of files `npm publish` would ship, without building a tarball.
 * npm 12 returns an object keyed by package name where earlier versions
 * returned an array, so accept either.
 */
function shippedFiles() {
  const raw = execFileSync(npm, ["pack", "--dry-run", "--json"], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const parsed = JSON.parse(raw);
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  return entry.files.map((f) => f.path);
}

const shipped = shippedFiles();

test("the schema itself is shipped, because the package is the schema", () => {
  assert.ok(shipped.includes("open-predicate-schema.json"));
  assert.ok(shipped.includes("tools/generate-filter-schema.mjs"));
});

test("every relative link in a shipped document points at a shipped file", () => {
  // The package ships a subset of the repository, so a doc that links to
  // ./examples/… reads fine on GitHub and is a dead link for anyone reading
  // the same file in node_modules. npmjs.com hides this for the README by
  // rewriting relative links against the repository, but only for the README
  // and only on that page — the installed copy is what this checks.
  const docs = shipped.filter((f) => f.endsWith(".md"));
  assert.ok(docs.length >= 3, "expected the docs to be shipped");

  const isShipped = (target) =>
    shipped.includes(target) || shipped.some((f) => f.startsWith(`${target}/`));

  const dead = [];
  for (const doc of docs) {
    const text = readFileSync(join(repo, doc), "utf8");
    // Repository-relative markdown links. Absolute URLs, bare fragments and
    // mailto: are somebody else's problem.
    for (const m of text.matchAll(/\]\((\.{1,2}\/[^)\s#]+)(#[^)\s]*)?\)/g)) {
      const target = normalize(posix.join(posix.dirname(doc), m[1])).split("\\").join("/");
      if (!isShipped(target)) dead.push(`${doc} -> ${m[1]}`);
    }
  }

  assert.deepEqual(
    dead,
    [],
    `shipped documents link to files that are not shipped:\n  ${dead.join("\n  ")}\n` +
      "Add the target to `files` in package.json, or make the link absolute.",
  );
});

test("a shipped document never links to a path outside the package", () => {
  // `../` in a packaged doc escapes the install directory entirely.
  for (const doc of shipped.filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(join(repo, doc), "utf8");
    for (const m of text.matchAll(/\]\((\.\.\/[^)\s#]+)/g)) {
      assert.fail(`${doc} links outside the package: ${m[1]}`);
    }
  }
});

test("the declared Node floor is the one the code actually needs", () => {
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  assert.ok(pkg.engines?.node, "engines.node must be declared");
  // 20.10 is where import attributes — `with { type: 'json' }`, which the
  // README documents as the way to read the schema — became available
  // unflagged. parseArgs in the generator needs less than that, so this is the
  // binding constraint.
  assert.equal(pkg.engines.node, ">=20.10.0");
  assert.ok(process.version.startsWith("v"), "sanity");
});

test("the bin is shipped and is the file the entry guard protects", () => {
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const bin = pkg.bin["open-predicate-generate"];
  assert.ok(shipped.includes(bin), `${bin} must be in the published files`);
  assert.ok(existsSync(join(repo, bin)));
  assert.ok(statSync(join(repo, bin)).size > 0);
  // Keep the shebang: npm links a bin as a symlink on Unix and execs it
  // directly, so without this it is not runnable at all.
  assert.match(readFileSync(join(repo, bin), "utf8").split("\n")[0], /^#!\/usr\/bin\/env node$/);
});
