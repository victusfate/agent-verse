# feature-chain

Run all four phases in sequence without pausing between them.
Pause only within Phase 1 (for answers) and at the end (review gate).

## Phase 1: Design (`/grill-with-docs`)

Interview the user one question at a time until the design tree is fully resolved.
Explore the codebase instead of asking when facts can be verified.
Produce `./docs/<feature-slug>/design.md` with canonical vocabulary, decisions, and diagrams.
Auto-advance to Phase 2 when complete — no permission needed.

## Phase 2: PRD (`/to-prd`)

Synthesize the conversation and codebase into `./docs/<feature-slug>/prd.md`.
Do not re-interview — use what is already established.
Commit `docs(<slug>): PRD` and auto-advance to Phase 3.

## Phase 3: Plan + TDD (`/tdd`)

Break `prd.md` into vertical slices — each slice cuts through all layers
(data → logic → UI → tests). Write `./docs/<feature-slug>/plan.md`.
Confirm granularity once, then execute RED → GREEN → REFACTOR per slice.
Commit per slice phase. Append status to `tdd-log.md` after each commit.

## Phase 4: Review

When all tests pass, present:
- Summary of what was built
- Test results
- Any deviations from `plan.md`

Prompt: "All tests pass. Please review the generated source before merging."
Wait for user confirmation before proceeding.

## Rules

- Stop the chain immediately if the user says "stop", "pause", or "just answer".
- Each phase's input is the previous phase's artifact — never skip ahead.
- One commit per artifact, one commit per TDD slice phase.
