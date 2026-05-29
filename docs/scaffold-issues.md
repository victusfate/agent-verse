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
