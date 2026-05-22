# to-prd

Synthesize the current context and codebase into `./docs/<feature-slug>/prd.md`.
Do not interview — use what is already established.

1. Explore the codebase to verify claims. Use canonical vocabulary from `design.md`.
   Review relevant ADRs if they exist.
2. Sketch major modules to build or modify; identify deep module opportunities
   with stable interfaces. Confirm testing needs with the user.
3. Write `prd.md` using this structure:
   - **Problem Statement** — user perspective
   - **Solution** — user perspective
   - **User Stories** — numbered, covering full surface including edge cases
   - **Implementation Decisions** — modules, interfaces, architecture; no file
     paths unless encoding a decision
   - **Testing Decisions** — what constitutes good tests, which modules to test,
     prior art
   - **Out of Scope** — explicit exclusions
   - **Further Notes** — open questions, follow-ups

When `prd.md` is written, commit `docs(<slug>): PRD` and automatically proceed
to the `/tdd` workflow without awaiting further permission.
