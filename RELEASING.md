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

npmjs.com authenticates by OIDC: the `npmjs` job requests `id-token: write`, and npm exchanges that token for a short-lived registry credential. There is no `NPM_TOKEN` in this repository and nothing to rotate. Provenance is attached automatically, so the tarball links back to the workflow run and the commit that built it.

**OIDC cannot perform a package's first publish.** npm requires the package to exist before a trusted publisher can be attached to it, so the very first version has to go up under a personal login. That bootstrap is a one-off:

```bash
npm login                    # the account must be a member of the open-predicate org
npm publish --access public  # claims @open-predicate/open-predicate

npm trust github --file release.yml  # run from the repo root
npm trust list                       # confirm it stuck
```

`npm trust github` is the CLI equivalent of npmjs.com → the package → *Settings* → **Trusted Publisher** → *GitHub Actions*. Either way the trust is pinned to the repository **and the workflow filename** — renaming `release.yml` breaks publishing until the trusted publisher is updated to match.

Four things about that command, all of which cost a failed attempt to learn:

- **`--file` is the only flag you need.** Run from the repo root, `npm trust` takes both the package name and the `owner/repo` from `package.json` and says so in its output (`(from package.json)`). Passing `--repository` by hand is how you get a typo into a one-shot, irreversible-feeling operation — it warns on a mismatch and then fails the POST with a bare `E400`.
- **`--file` takes the workflow's *filename* only**, not a path under `.github/workflows/`, and it must end in `.yml` or `.yaml`.
- **npm's published documentation is ahead of the shipped CLI.** [docs.npmjs.com](https://docs.npmjs.com/cli/v11/commands/npm-trust/) describes `--allow-publish` and `--allow-stage-publish`; npm 11.12.1 rejects both as unknown flags. Publish is permitted by default, so nothing is lost.
- **It requires account-level 2FA and prompts for an OTP**, so it cannot be run unattended. Add `--dry-run` to check the resolved package, file and repository before committing to it.

Afterwards, set the package's publishing access to **Require two-factor authentication and disallow tokens**. That closes off token auth without affecting OIDC, which is the point of moving to it.

## The reserved unscoped name

`open-predicate`, unscoped, is published once as a deprecated placeholder so the name cannot be
taken by something unrelated to the project. It carries no schema and no code, is not versioned
alongside releases, and the release pipeline never touches it. Recreate and publish it like this:

```bash
d=$(mktemp -d) && cd "$d"
cat > package.json <<'JSON'
{
  "name": "open-predicate",
  "version": "0.0.1",
  "description": "Name reserved. The package is @open-predicate/open-predicate — install that instead.",
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/OpenPredicate/open-predicate.git" },
  "homepage": "https://github.com/OpenPredicate/open-predicate#readme",
  "files": ["README.md"]
}
JSON
printf '# open-predicate\n\n**Reserved.** Install `@open-predicate/open-predicate` instead.\n' > README.md

npm publish
npm deprecate open-predicate "Moved to @open-predicate/open-predicate — install that instead."
```

The `npm deprecate` is the part that matters: it makes `npm install open-predicate` print the
redirect rather than silently installing an empty package.

An unscoped package is owned by the publishing user rather than by an organisation. Transfer it
with `npm owner add`, or from npmjs.com → the package → *Settings* → **Transfer**, so it does not
depend on one account.

## Notes worth keeping

These cost time to work out.

- **The trust is per-package, not per-org.** A second package under `@open-predicate` needs its own `npm trust github`, and its own bootstrap publish.
- **`npm trust` needs account-level 2FA** and will not accept a granular token with *Bypass 2FA*, or legacy basic auth.
- **`npm view` can 404 on a package that is already published.** It reads a CDN-cached packument, which lags the publish by minutes. `npm dist-tag ls <pkg>` and `npm access get status <pkg>` hit the registry API directly and are what to trust when checking whether a publish landed.
- **A rehearsal cannot prove npmjs auth works.** `npm publish --dry-run` does not authenticate, and the OIDC credential is only minted by a real publish — so unlike the old token-based job, there is no `npm whoami` that proves the credential ahead of time. The GitHub Packages job still runs one, because that half is still token-authenticated.
- **Trusted publishing needs npm >= 11.5.1**, which is why the `npmjs` job installs `npm@latest` rather than trusting the runner image.
- **`environment: release` is decoration until you configure it.** Referencing an environment that does not exist does not block the run; GitHub creates it with no protection rules. Add yourself as a required reviewer under *Settings → Environments → release* to make it a real gate. If you also name that environment in the trusted publisher config, the two must agree or publishing fails.
- **npm blocks a name from reuse permanently once it has been published and unpublished.** The bootstrap claims `@open-predicate/open-predicate` for good. That was the reason publishing stayed off while the name was a working title; the name is settled now, so the trade is worth making.

## Serving the schema from its `$id`

Serving `https://openpredicate.tech/schema/` is the other half of this and is not wired up. Until it is, the `$id` is an identifier rather than a location — which JSON Schema permits, and which every example in the repository works around by `$ref`-ing the local copy.

Meanwhile the schema can also be vendored directly. It is self-contained and has no runtime dependencies:

```bash
curl -O https://raw.githubusercontent.com/OpenPredicate/open-predicate/main/open-predicate-schema.json
```

Pin a tag rather than `main` if you want a stable copy — swap `main` for `v0.6.0` in that URL.
