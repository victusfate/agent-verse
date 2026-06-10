# Scaffold Issues — Found in agent-verse bootstrap (sync 3efb293)

## Correctness bugs

**1. `bin/sync-from-scaffold.sh` — staged edits are overwritten**
`git diff --quiet -- "$file"` only checks working-tree vs index. A file that has been `git add`-ed but not committed passes the guard and gets silently overwritten by the three-way merge.
```sh
# line 55 — fix: check both
if ! git diff --quiet -- "$file" || ! git diff --cached --quiet -- "$file"; then
```

**2. `.github/workflows/sync-scaffold.yml` — new untracked files not detected as changes**
`git diff --quiet && git diff --staged --quiet` exits 0 for *untracked* files. Sync writes new skill files as untracked → `changed=false` → PR step skipped → new files silently dropped.
```sh
# fix: include untracked
if git diff --quiet && git diff --staged --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
```

**3. `.github/workflows/sync-scaffold.yml` — `gh pr create` errors swallowed**
`gh pr create ... || echo "PR already open"` catches *all* non-zero exits (missing label, auth failure, network error), not just the already-exists case. CI reports success with no PR created.
```sh
# fix: check exit code first or use --no-error-on-existing-pr flag approach
gh pr create ... || (code=$?; git ls-remote --exit-code origin HEAD:refs/pulls || exit $code)
```

**4. `scripts/check-resolvable.mjs` — blank line in RESOLVER table silently drops rows**
`parseResolver` breaks out of the table loop on *any* non-pipe line while `inTable` is true. A blank separator line between rows causes all subsequent skills to be skipped with no error — they show up as orphans on disk but the rows-not-found path is never reached.
```js
// line 88 — fix: skip blank lines instead of breaking
if (!isRow) {
  if (inTable && line.trim() !== '') break;
  continue;
}
```

**5. `bin/sync-from-scaffold.sh` — temp files leak on `set -e` abort**
Three `mktemp` files are allocated before `git show` calls that can abort via `set -euo pipefail`, with no `trap` to guarantee cleanup.
```sh
# fix: add trap before the mktemp calls
trap 'rm -f "$ours" "$base" "$theirs"' EXIT
ours=$(mktemp); base=$(mktemp); theirs=$(mktemp)
```

---

## Minor quality nits (low impact at small N)

- `check-resolvable.mjs`: duplicate `// Phase 6` comment label on both `phaseCursorParity` and `phaseScaffold`.
- `phaseAmbiguity`: O(N²) symmetric scan — start inner loop at `i+1` like `phaseMece` does.
- `manifestSet`: mutable lazy-init sentinel (`let _manifest = null`) — a module-level `const` computed once is simpler.
- `compileCell`: `replace(/\\\|/g, '|')` unescapes *all* `\|` in the regex body, which would corrupt an intentional literal-pipe match in a future skill regex. Scope the unescape to table-context only.

---

*Identified during bootstrap of `victusfate/agent-verse` @ sync SHA `3efb293`. Fixes should land in `victusfate/scaffold` so all downstream repos inherit them.*

---

## Quality audit findings (2026-06-09, sync SHA `cddbe59`)

Found during the full-codebase quality audit (`docs/quality-modest-maxwell-6PD3C/design.md`,
findings F-35–F-37). These live in scaffold-owned files, so the fixes belong upstream.

**F-35 — `splitRow`/`parseResolver` duplicated across scaffold scripts**
`scripts/check-resolvable.mjs` and `scripts/update-readme-skills.mjs` carry near-verbatim
copies of the RESOLVER.md table parser (update-readme's copy has already lost the
malformed-row error reporting). Extract a shared `scripts/lib/resolver.mjs` and import it
from both. (`tools/hoist-skill`'s standalone copy is deliberate — it is fetched into
consumer repos — and is exempt; consider a one-line comment saying so.)

**F-36 — agent-authoring-requirements §6 checklist violations**
- `tools/hoist-skill/run` and `test` are not executable (`-rw-r--r--`); §2 requires `+x`.
- Unknown/misspelled flags are silently ignored (e.g. `--harnes cursor` emits claude);
  §2 requires rejecting malformed input non-zero.
- `bin/bootstrap.sh` and `bin/sync-from-scaffold.sh` use repo-root-relative paths without
  resolving the root (`git rev-parse --show-toplevel`); run from a subdirectory they
  create nested `bin/` dirs or write files into the subdir (§2a).
- `bin/bootstrap.sh` unconditionally overwrites an existing `bin/sync-from-scaffold.sh`
  (no `.scaffold-keep` check or sidecar), bypassing the clobber-safe contract.
- `"${files[@]}"` under `set -u` breaks on bash 3.x (macOS default for the documented
  `curl | bash` audience) when the manifest is empty.
- No isolated test or documented acceptance check exists for either bin entrypoint.

**F-37 — minor efficiency nits**
- `tools/hoist-skill` (pre-refactor `run`, now `hoist.mjs`): `registry.find(...)` inside
  loops — build a `Map` by name once after `parseResolver`.
- `scripts/update-readme-skills.mjs` reads `README.md` from disk twice (once for content,
  once for the staleness compare) — capture the first read.

**Sync bug observed during `cddbe59` sync (one-off, worth a guard)**
A re-run of `bin/sync-from-scaffold.sh` after a conflict-resolution commit appended a
duplicate section to `scripts/check-resolvable.mjs` (duplicate `frontmatterDescription`
declaration → SyntaxError). Restored from `scaffold/main`. The three-way merge should
not produce duplicated content when the local file already matches the incoming base.
