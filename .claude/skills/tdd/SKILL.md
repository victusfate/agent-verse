# tdd

Execute `./docs/<feature-slug>/plan.md` one vertical slice at a time. If
`plan.md` doesn't exist, create it from `prd.md` first — vertical slices
cutting through all layers: data → logic → UI → tests. Proceed immediately —
no confirmation needed.

**Never write all tests first then all code.** One test → minimal
implementation → repeat.

Per slice:
- **RED**: Write one test for one behavior → confirm it fails.
- **GREEN**: Write minimal code to pass → confirm it passes.
- **REFACTOR**: Extract duplication, deepen modules — only after GREEN, never
  while RED.

Tests verify behavior through public interfaces only. A good test reads like a
specification and survives internal refactors.

After each slice commit:
```
test(<slug>): slice N red — <behavior>
feat(<slug>): slice N green — <behavior>
refactor(<slug>): slice N — <what changed>
```

Append slice status to `./docs/<feature-slug>/tdd-log.md` after each commit.

When all slices are complete, present a summary and wait for user review before
merging: "All tests pass. Please review the generated source before merging."
