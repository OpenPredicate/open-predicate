# Releasing

A release is a git tag, a GitHub Release, and a package on two registries. Publishing a GitHub Release is the trigger: [`.github/workflows/release.yml`](./.github/workflows/release.yml) runs the test suite, checks the tag against `package.json`, and ships the same commit to both.

| Registry | Name | Auth | Install needs a token? |
| --- | --- | --- | --- |
| [npmjs.com](https://www.npmjs.com/package/@open-predicate/open-predicate) | `@open-predicate/open-predicate` | OIDC trusted publishing — **no secret** | No |
| GitHub Packages | `@openpredicate/open-predicate` | `GITHUB_TOKEN`, minted per run | Yes |

A third name, unscoped `open-predicate`, is held as a [deprecated placeholder](#the-reserved-unscoped-name). It is not a release target and the pipeline never touches it.

The two release names differ because GitHub Packages accepts only scoped names and the scope must be the repository owner — the `OpenPredicate` organisation, hence `@openpredicate`, lowercased because npm rejects uppercase in a package name. npmjs.com carries the `@open-predicate` scope, which is the npm organisation. Only the `name` field differs; the workflow rewrites it in the GitHub Packages job and the tarball is otherwise identical.

**npmjs.com is the copy to document.** It needs no credential to install. The GitHub Packages copy needs an `.npmrc` with `@openpredicate:registry=https://npm.pkg.github.com` and a token even though the package is public.

## Cutting a release

1. Bump `version` in `package.json` (and `package-lock.json` — `npm install` does it).
2. If the schema's grammar changed, bump the version in the schema's `$id` too. The `$id` is what consumers pin, so it is the version that actually matters to them.
3. Add the `CHANGELOG.md` entry and its compare link at the bottom of the file.
4. Commit, then tag: `git tag -a v0.6.0 -m "v0.6.0" && git push --follow-tags`.
5. On GitHub, draft a Release against that tag, paste the changelog entry, and **Publish release**.

To rehearse, run it by hand from Actions → *Release* → **Run workflow**. It defaults to a dry run, which exercises packaging and the already-published guard without uploading — but see the note below on what a rehearsal cannot prove.

Each publish job checks whether its version already exists and skips if so, so re-running a partially-failed release is safe when one registry succeeded and the other did not.

## Trusted publishing, and the one-time bootstrap

npmjs.com authenticates by OIDC: the `npmjs` job requests `id-token: write`, and npm exchanges that token for a short-lived registry credential. There is no `NPM_TOKEN` in this repository and nothing to rotate. Provenance is attached automatically, so the tarball links back to the workflow run and the commit that built it — **but only for tarballs this workflow publishes.** 0.6.0 has none: the bootstrap publish that claims a trusted publisher has to come from a laptop, because OIDC cannot mint a credential for a package that does not exist yet, and the registry metadata records npm 11.12.1 on Node 25 — nobody's runner image. 0.6.1 is the first release published over OIDC and so the first with provenance. Verify it rather than assuming:

```bash
npm view @open-predicate/open-predicate@0.6.1 dist.attestations   # empty output means there is none
```

**OIDC cannot perform a package's first publish.** npm requires the package to exist before a trusted publisher can be attached to it, so the very first version has to go up under a personal login. That bootstrap is a one-off:

```bash
npm login                    # the account must be a member of the open-predicate org
npm publish --access public  # claims @open-predicate/open-predicate

npm install -g npm@12                # npm 11 cannot configure trust; see below
npm trust github --file release.yml --allow-publish   # run from the repo root
npm trust list                       # confirm it stuck
```

`npm trust github` is the CLI equivalent of npmjs.com → the package → *Settings* → **Trusted Publisher** → *GitHub Actions*. Either way the trust is pinned to the repository **and the workflow filename** — renaming `release.yml` breaks publishing until the trusted publisher is updated to match.

Four things about that command, all of which cost a failed attempt to learn:

- **Do not pass `--repository`.** Run from the repo root, `npm trust` takes both the package name and the `owner/repo` from `package.json`, and labels them `(from package.json)` in its output. Passing the repository by hand is how a truncated `OpenPredicate/open-predicat` gets into the request: npm warns about the mismatch, then the POST fails with the same bare `E400` that a stale client produces, so the two causes are indistinguishable from the error alone.
- **`--file` takes the workflow's *filename* only**, not a path under `.github/workflows/`, and it must end in `.yml` or `.yaml`.
- **Configuring trust needs npm >= 12, and fails opaquely on npm 11.** npm 11.12.1 rejects `--allow-publish` as an unknown flag, and without it its `POST /-/package/<pkg>/trust` body carries no `permissions` member — which the registry now requires, so it answers a bare `E400` with no message and npm prints nothing more. Comparing `lib/trust-cmd.js` between the two versions is what shows it: npm 12 sets `trustConfig.permissions = ['createPackage']`, npm 11 has no such line. This is separate from the npm version *publishing* needs.
- **It requires account-level 2FA and prompts for an OTP**, so it cannot be run unattended. Add `--dry-run` to check the resolved package, file and repository before committing to it — `--dry-run` returns before the POST, so it passes on npm 11 even though the real call cannot.

Afterwards, set the package's publishing access to **Require two-factor authentication and disallow tokens**. That closes off token auth without affecting OIDC, which is the point of moving to it.

**The configuration in force**, as `npm trust list` reports it:

| | |
| --- | --- |
| `id` | `d8641874-290e-4f26-b68b-6af472c8cb44` |
| `type` | `github` |
| `repository` | `OpenPredicate/open-predicate` |
| `file` | `release.yml` |
| `permissions` | `publish, stage publish` |

The `id` is written down here because `npm trust revoke --id=<id>` is the only way to remove a
configuration, and the only way to read the id back is `npm trust list`, which needs two-factor
auth. It is an identifier, not a credential — revoking still requires an authenticated owner.

`permissions` covers `stage publish` as well as `publish` even though only `--allow-publish` was
passed. Nothing here uses `npm stage publish`; narrow it by revoking and re-creating if that
bothers you.

## The reserved unscoped name

`open-predicate`, unscoped, is published once as a deprecated placeholder so the name cannot be
taken by something unrelated to the project. It carries no schema and no code, is not versioned
alongside releases, and the release pipeline never touches it. Recreate and publish it like this:

````bash
d=$(mktemp -d) && cd "$d"
cat > package.json <<'JSON'
{
  "name": "open-predicate",
  "version": "0.0.1",
  "description": "Name reserved. The package is @open-predicate/open-predicate — install that instead.",
  "license": "MIT",
  "author": "Christos Gkoros",
  "repository": { "type": "git", "url": "git+https://github.com/OpenPredicate/open-predicate.git" },
  "homepage": "https://github.com/OpenPredicate/open-predicate#readme",
  "bugs": { "url": "https://github.com/OpenPredicate/open-predicate/issues" },
  "keywords": ["open-predicate", "openpredicate"],
  "publishConfig": { "registry": "https://registry.npmjs.org" },
  "files": ["README.md"]
}
JSON
cat > README.md <<'MD'
# open-predicate

**This name is reserved. Nothing is published here.**

OpenPredicate is distributed as a scoped package:

```bash
npm install @open-predicate/open-predicate
```

This placeholder exists only so the unscoped name cannot be taken by something
unrelated to the project. It carries no schema and no code, and it is not
versioned alongside releases.

MIT.
MD

npm publish
npm deprecate open-predicate "Moved to @open-predicate/open-predicate — install that instead."
````

The `npm deprecate` is the part that matters: it makes `npm install open-predicate` print the
redirect rather than silently installing an empty package.

Both commands need two-factor auth, so they cannot be run unattended — `npm publish` reaches
`EOTP` and prints its web-auth URL only to a TTY.

An unscoped package is owned by the publishing user rather than by an organisation. Transfer it
with `npm owner add`, or from npmjs.com → the package → *Settings* → **Transfer**, so it does not
depend on one account.

## Notes worth keeping

These cost time to work out.

- **The trust is per-package, not per-org.** A second package under `@open-predicate` needs its own `npm trust github`, and its own bootstrap publish.
- **`npm trust` needs account-level 2FA** and will not accept a granular token with *Bypass 2FA*, or legacy basic auth.
- **`npm view` can 404 on a package that is already published.** It reads a CDN-cached packument, which lags the publish by minutes. `npm dist-tag ls <pkg>` and `npm access get status <pkg>` hit the registry API directly and are what to trust when checking whether a publish landed.
- **A rehearsal cannot prove npmjs auth works.** `npm publish --dry-run` does not authenticate, and the OIDC credential is only minted by a real publish — so unlike the old token-based job, there is no `npm whoami` that proves the credential ahead of time. The GitHub Packages job still runs one, because that half is still token-authenticated.
- **Two different npm version floors.** *Publishing* over OIDC needs npm >= 11.5.1, which is why the `npmjs` job installs `npm@latest` rather than trusting the runner image. *Configuring* the trusted publisher needs npm >= 12, per the bullet above.
- **npm 12 will not *install* on an unsupported Node.** Its engine range is `^22.22.2 || ^24.15.0 || >=26.0.0`, and on Node 25 `npm install -g npm@12` fails outright with `EBADENGINE`/`notsup` — npm refuses to replace itself with a version its runtime does not support. `npx npm@12 …` only warns, so it works for a one-off; otherwise move Node onto a supported line first. `brew upgrade node` to 26 does it, and removes the old kegs on the way.
- **`E400` and `EOTP` tell you different things.** `E400` means the registry rejected the payload — on npm 11, the missing `permissions`. `EOTP` means the payload was accepted and only two-factor auth is outstanding, so it is the *good* failure: finish it interactively. The web-auth URL is printed only to a TTY.
- **`environment: release` is decoration until you configure it.** Referencing an environment that does not exist does not block the run; GitHub creates it with no protection rules. Add yourself as a required reviewer under *Settings → Environments → release* to make it a real gate. If you also name that environment in the trusted publisher config, the two must agree or publishing fails.
- **npm blocks a name from reuse permanently once it has been published and unpublished.** The bootstrap claims `@open-predicate/open-predicate` for good. That was the reason publishing stayed off while the name was a working title; the name is settled now, so the trade is worth making.

## Serving the schema from its `$id`

This is wired up. The `$id` is now both an identifier and a location:

```bash
curl -sI https://openpredicate.tech/schema/v0.4.0/open-predicate-schema.json
# HTTP/2 200 · application/schema+json · access-control-allow-origin: * · immutable
```

**Serving it is a second repository's job, so a release is not finished when the tag is pushed.** The site at [`OpenPredicate/openpredicate.tech`](https://github.com/OpenPredicate/openpredicate.tech) vendors the specification artefacts rather than paraphrasing them, and its build never touches the network — so the copy is refreshed by an explicit step:

```bash
# in the openpredicate.tech checkout
node sync.mjs v0.6.0     # pulls SPEC.md, CHANGELOG.md, COMPARISON.md, the examples and the schema
```

`sync.mjs` reads the grammar version out of the schema's own `$id` and writes the file to the directory that `$id` names, so a release that moves the grammar **adds** a directory rather than overwriting a published one. That is what keeps the versioned URLs immutable, as SPEC.md §9 requires. Cache headers are decided at build time and written to `dist/_headers`, because Netlify cannot scope headers per deploy context in `netlify.toml`.

So the order is: tag here → GitHub Release → npm publishes over OIDC → `node sync.mjs <tag>` there → commit and deploy. Skipping the last step leaves the new grammar version unresolvable while the package already references it.

The schema can also be vendored directly. It is self-contained and has no runtime dependencies:

```bash
curl -O https://raw.githubusercontent.com/OpenPredicate/open-predicate/v0.6.0/open-predicate-schema.json
```

Pin a tag rather than `main`, as above, if you want a copy that cannot move under you.
