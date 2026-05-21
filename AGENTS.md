# Agent Guidelines

## Project Overview

**agent-verse** is an autonomous, self-improving corporate AI ecosystem built in Python.
It implements the four-agent loop described in the blueprint document:

```
Idea-Agent → CEO-Agent → Operator-Agents (Product / Engineering / Customer-Success)
                                         ↑                                       |
                                         └──────── Monitor-Agent ────────────────┘
```

### Key Files

| Path | Purpose |
|---|---|
| `src/main.py` | Entry point — `python -m src.main` |
| `src/graph.py` | LangGraph state graph wiring all agents together |
| `src/llm.py` | Unified LiteLLM client (all providers via `AGENT_MODEL`) |
| `src/agents/` | `idea_agent`, `ceo_agent`, `operator_agent`, `monitor_agent` |
| `src/ledger.py` | Append-only SQLite event ledger (Total Legibility Layer) |
| `src/company_brain.py` | `context_framework.json` + `skills.md` per company |
| `src/schemas.py` | Pydantic models for all inter-agent data |
| `companies/` | Runtime output — one folder per venture |
| `requirements.txt` | Python deps |

### Run

```bash
# copy env template and fill in at least one provider key
cp .env.example .env

# run with default model (claude-sonnet-4-6)
python -m src.main

# run with a specific model or seed
python -m src.main --model gemini/gemini-2.5-flash
python -m src.main --model gpt-4o-mini --seed "AI invoice reconciliation API"
python -m src.main --model ollama/llama3.2   # requires local Ollama daemon
```

### Model Selection

Set `AGENT_MODEL` in `.env` or pass `--model` at runtime:

| Model string | Provider | Required env var |
|---|---|---|
| `claude-sonnet-4-6` (default) | Anthropic | `ANTHROPIC_API_KEY` |
| `gpt-4o-mini` | OpenAI | `OPENAI_API_KEY` |
| `gemini/gemini-2.5-flash` | Google Gemini | `GEMINI_API_KEY` |
| `ollama/llama3.2` | Local Ollama | none (needs daemon) |
| `openrouter/<vendor>/<model>` | OpenRouter | `OPENROUTER_API_KEY` |

### Architecture Constraints (from blueprint)

1. **Total Legibility** — every event writes to `companies/ledger.db` (SQLite append-only).
2. **Ephemeral Software** — `companies/<id>/` is runtime state; the source in `src/` is the durable asset.
3. **Human-at-the-Edge** — agents auto-escalate high/critical risk tasks; humans only intervene at those gates.

---

## Session Start

On your first response in a new session, check `./docs/` for existing feature
artifacts (`design.md`, `prd.md`, `plan.md`).

- **Artifacts exist:** acknowledge them and ask how to continue.
- **No artifacts + user describes a feature to build:** automatically start
  `/feature-chain` — no permission needed.
- **No artifacts + intent unclear:** ask once: "What are we building today?"

Don't ask again in the same session.

## Minimum Viable Diff

Prefer the smallest change that achieves the goal.

- Single, targeted edits. Don't rewrite when a few-line change works.
- Preserve existing structure, naming, and patterns unless a rewrite is asked for.
- No opportunistic refactors — surface them as separate suggestions.
- No style-preference rewrites. Working code stays as-is.
- When in doubt, ask before producing a diff larger than ~30 lines.

## The Chain

Run `/feature-chain` to execute all phases automatically. Or invoke individually:

1. **Design** — `/grill-with-docs`. Interview one question at a time until
   the design tree is resolved. Produces `design.md` with Q&A, decisions, and
   a **canonical vocabulary**. Auto-advances to PRD when complete.

2. **PRD** — `/to-prd`. Synthesize context and codebase into `prd.md` without
   re-interviewing. Auto-advances to TDD when complete.

3. **Plan** — break `prd.md` into **vertical slices** (each cuts through all
   layers: data → logic → UI → tests). Output `plan.md`. Confirm granularity
   once before coding.

4. **TDD** — `/tdd`. Execute `plan.md` one slice at a time: RED → GREEN →
   REFACTOR. Maintain `tdd-log.md` with per-slice status.

**Stop** the chain at any point by saying "stop", "pause", or "just answer".

## Artifacts — One Folder Per Feature

State the slug before writing the first file so I can correct it.

```
./docs/<feature-slug>/
  ├── design.md      # Q&A, decisions, scenarios, canonical vocabulary
  ├── prd.md         # full PRD
  ├── plan.md        # vertical slices
  └── tdd-log.md     # per-slice TDD status
```

Feature-slug rule: kebab-case, drop articles, keep it under ~30 chars.

## Git Commits — One Per Step

Commit each artifact before moving on:

- `docs(<slug>): design Q&A and vocabulary`
- `docs(<slug>): PRD`
- `docs(<slug>): implementation plan`

For TDD, commit per phase per slice:

- `test(<slug>): slice N red — <behavior>`
- `feat(<slug>): slice N green — <behavior>`
- `refactor(<slug>): slice N — <what changed>` (only if refactor happened)

## Retry Semantics

Each step's input is the prior step's artifact:

- Bad TDD slice → revert those commits, re-run from `plan.md` slice N.
- Plan off → re-plan from `prd.md`.
- PRD missed something → extend `design.md`, then rewrite `prd.md`.
- Terms drift → update vocabulary in `design.md`, then propagate.

## What This Doesn't Apply To

Skip the chain for:

- Bug fixes under ~10 lines
- One-off scripts or throwaway prototypes
- Config edits, dependency bumps, lint fixes
- Doc-only changes
- Anything where I say "just write it", "no tests", or "quick fix"

## PR Workflow

1. Pull latest main: `git checkout main && git pull origin main`
2. Create a clean branch: `git checkout -b <prefix>/<short-descriptive-name>`
3. Do the work, verify with build/tests
4. Commit, push: `git push -u origin <branch>`
5. Create PR
6. After merge, pull main again

Never commit directly to main for feature work. Never reuse an old branch for a new PR.
