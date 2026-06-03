# Releasing

Publishing is automated by CI on tag push. Never run `npm publish` by hand.

## Steps
1. Bump `version` in `package.json` + `package-lock.json` (2 places in the lock).
2. Move the `CHANGELOG.md` `Unreleased` heading to the new version + date.
3. Commit on `main`, push.
4. Tag + push: `git tag vX.Y.Z && git push origin main vX.Y.Z`
5. `.github/workflows/ci.yml` runs lint+test, then the `publish` job:
   - prerelease (`vX.Y.Z-foo`) → npm dist-tag `alpha`; stable → `latest`
   - skips if that version is already on npm (safe to re-push a tag)
6. GitHub Release: `gh release create vX.Y.Z [--prerelease] --title ... --notes ...`

The tag must point at a commit that contains the `publish` job. After a
release-time amend, re-point the tag (`git tag -f`) before pushing it.

## Auth — tokenless (npm Trusted Publishing / OIDC)
No `NPM_TOKEN` secret. The `publish` job has `id-token: write` and installs
`npm@latest` (>=11.5.1); npm exchanges the GitHub OIDC token for a short-lived
publish credential and attaches build provenance.

npm-side config (one-time, already done): npmjs.com → package → Settings →
Trusted Publisher → GitHub Actions · org `mosandlt` · repo
`Bosch-Smart-Home-Camera-Tool-NodeRED` · workflow `ci.yml` · no environment.

## Local gate
`prepublishOnly` runs `npm run lint && npm test` automatically on every publish.
