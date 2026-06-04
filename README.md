# agent-verse

An autonomous, self-improving corporate AI ecosystem. Drop in a seed idea (or let the system generate one) and watch four specialized agents ideate, staff, execute, and continuously improve a micro-business venture — all logged to an append-only ledger for full auditability.

---

## Architecture

```
                        ┌─────────────────────────────────────────────────┐
                        │                  agent-verse                    │
                        │                                                 │
                        │   ┌─────────────┐                               │
                        │   │  Idea-Agent │  Generates (or accepts) a     │
                        │   │             │  VenturePayload: name, value   │
                        │   │  💡 ideate  │  prop, audience, capabilities  │
                        │   └──────┬──────┘                               │
                        │          │ VenturePayload                        │
                        │          ▼                                       │
                        │   ┌─────────────┐                               │
                        │   │  CEO-Agent  │  Provisions company dir,      │
                        │   │             │  writes context_framework.json │
                        │   │  🏢 staff   │  + skills.md, emits 3 tasks   │
                        │   └──────┬──────┘                               │
                        │          │ OperatorTask[]                        │
                        │          ▼                                       │
                        │   ┌──────────────────────────────────────────┐  │
                        │   │          Operator Loop (max N cycles)    │  │
                        │   │                                          │  │
                        │   │  ┌────────────┐  ┌────────────┐  ┌────┐ │  │
                        │   │  │  Product   │  │Engineering │  │ CS │ │  │
                        │   │  │  Operator  │  │  Operator  │  │    │ │  │
                        │   │  │ 📦 build   │  │ ⚙️  build  │  │ 🤝 │ │  │
                        │   │  └────────────┘  └────────────┘  └────┘ │  │
                        │   │       │ (parallel execution)       │      │  │
                        │   │       └──────────────┬─────────────┘      │  │
                        │   │                      │ telemetry           │  │
                        │   │                      ▼                     │  │
                        │   │              ┌───────────────┐             │  │
                        │   │              │ Monitor-Agent │             │  │
                        │   │              │               │             │  │
                        │   │              │ 🔍 diagnose   │ ──▶ update  │  │
                        │   │              │    & improve  │    skills   │  │
                        │   │              └───────┬───────┘             │  │
                        │   │                      │ iteration_complete? │  │
                        │   └──────────────────────┼─────────────────────┘  │
                        │                          │                        │
                        │              ┌───────────▼────────────┐           │
                        │              │    companies/ledger.db  │           │
                        │              │    (append-only SQLite) │           │
                        │              └────────────────────────┘           │
                        └─────────────────────────────────────────────────┘
```

---

## Four-Agent Loop

### 1 — Idea-Agent
Scans the landscape for high-margin, low-overhead digital opportunities. Given an optional `--seed` prompt it refines; without one it generates freely. Outputs a `VenturePayload` with a validated token-cost ceiling.

### 2 — CEO-Agent
Turns the payload into a live company:
- Creates `companies/<company_id>/`
- Writes `context_framework.json` (mission, constraints, token budget)
- Writes `skills.md` (operational playbooks, API recipes, guardrails)
- Provisions exactly three `OperatorTask`s for the three operator roles

### 3 — Operator-Agents (parallel)
Three roles execute concurrently through a **5-layer recursive loop**:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Operator Execution Stack                        │
│                                                                      │
│  Layer 1 — SENSOR        Ingest task from shared state              │
│      │                                                               │
│      ▼                                                               │
│  Layer 2 — POLICY        Risk evaluation                            │
│      │                   ├─ low / medium → proceed                  │
│      │                   └─ high / critical → escalate to human ⚠️  │
│      ▼                                                               │
│  Layer 3 — TOOL          LLM-driven execution                       │
│      │                   reads skills.md + context_framework.json   │
│      │                   returns deliverable + artifacts + confidence│
│      ▼                                                               │
│  Layer 4 — QUALITY GATE  Structural validation                      │
│      │                   ├─ deliverable length ≥ 20 chars           │
│      │                   ├─ confidence ≥ 0.3                        │
│      │                   └─ artifacts non-empty                     │
│      ▼                                                               │
│  Layer 5 — LEARNING      Package telemetry                          │
│                          appends to task_log.jsonl + ledger         │
└─────────────────────────────────────────────────────────────────────┘
```

### 4 — Monitor-Agent
After each operator cycle, the Monitor:
1. Queries the ledger for failures and friction points
2. Diagnoses root causes (`code_fix` | `data_optimization` | `skills_update` | `none`)
3. If `skills_update`: rewrites `skills.md` with improved playbooks
4. Decides `iteration_complete` — terminates the loop or triggers another cycle

---

## Data Flow

```
  ┌──────────────┐     VenturePayload      ┌──────────────┐
  │  Idea-Agent  │ ─────────────────────▶  │  CEO-Agent   │
  └──────────────┘                         └──────┬───────┘
                                                  │ OperatorTask[]
                                                  ▼
                              ┌───────────────────────────────────┐
                              │         AgentState (graph)         │
                              │  venturePayload                    │
                              │  companyId                         │
                              │  operatorTasks[]                   │
                              │  cycle                             │
                              │  monitorReport                     │
                              │  iterationComplete                 │
                              └───────────────┬───────────────────┘
                                              │
                    ┌─────────────────────────┼──────────────────────┐
                    ▼                         ▼                      ▼
           ┌──────────────┐         ┌──────────────┐       ┌──────────────┐
           │   Product    │         │ Engineering  │       │  Customer    │
           │   Operator   │         │   Operator   │       │   Success    │
           └──────┬───────┘         └──────┬───────┘       └──────┬───────┘
                  │                        │                       │
                  └────────────────────────┼───────────────────────┘
                                           │ telemetry entries
                                           ▼
                                  ┌─────────────────┐
                                  │  Monitor-Agent  │
                                  └────────┬────────┘
                                           │ MonitorReport
                                           ▼
                                  ┌─────────────────┐
                                  │  iteration_     │
                                  │  complete?      │
                                  └────────┬────────┘
                                     No   │   Yes
                              ┌──────────┘   └──────────┐
                              ▼                          ▼
                         next cycle               final summary
```

---

## Company Brain

Each venture gets a persistent knowledge store that survives across cycles:

```
companies/
├── ledger.db                          ← append-only event log (shared)
└── <company_id>/
    ├── context_framework.json         ← mission, constraints, token budget
    ├── skills.md                      ← operational playbooks (rewritten by Monitor)
    └── task_log.jsonl                 ← line-delimited task completion records
```

`context_framework.json` example:
```json
{
  "company_id": "acme-invoice-ai-7f3a",
  "mission": "Automate invoice reconciliation for SMBs via API",
  "token_budget_usd": 50,
  "tokens_consumed_usd": 4.2,
  "constraints": ["fully digital", "no human ops"],
  "capabilities": ["PDF parsing", "GL matching", "webhook delivery"]
}
```

`skills.md` grows richer with every Monitor cycle — it is the venture's **lived operational memory**.

---

## Ledger (Total Legibility Layer)

Every agent event is appended to `companies/ledger.db`:

```sql
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT    NOT NULL,          -- ISO-8601 timestamp
  company_id TEXT    NOT NULL,
  event_type TEXT    NOT NULL,          -- e.g. "task_completed", "monitor_report"
  agent_type TEXT,                      -- "idea" | "ceo" | "operator" | "monitor"
  payload    TEXT    NOT NULL           -- JSON blob
);
```

The Monitor queries this table to find friction points and diagnose systemic failures. Nothing is ever deleted — the ledger is the ground truth.

---

## LLM Provider Support

The system uses a unified provider-agnostic interface. Set `AGENT_MODEL` in `.env` or pass `--model` at runtime:

| Model string | Provider | Env var needed |
|---|---|---|
| `claude-sonnet-4-6` (default) | Anthropic | `ANTHROPIC_API_KEY` |
| `gpt-4o-mini` | OpenAI | `OPENAI_API_KEY` |
| `gemini/gemini-2.5-flash` | Google | `GEMINI_API_KEY` |
| `llama3.2` / `qwen` / `mistral` | Local Ollama | none (needs daemon) |
| `openrouter/<vendor>/<model>` | OpenRouter | `OPENROUTER_API_KEY` |

Provider is auto-detected from the model ID prefix — no extra config needed.

---

## Schemas

All inter-agent data is validated with Zod:

```
VenturePayload
├── company_name: string
├── core_value_proposition: string
├── target_audience: string
├── initial_capability_requirements: string[]
└── estimated_token_cost_ceiling_usd: number

OperatorTask
├── task_id: string
├── company_id: string
├── role: "product" | "engineering" | "customer-success"
├── description: string
├── risk_tier: "low" | "medium" | "high" | "critical"
├── status: "pending" | "in_progress" | "completed" | "failed" | "blocked"
├── result?: string
└── error?: string

MonitorReport
├── company_id: string
├── cycle: number
├── friction_points: string[]
├── diagnosis: string
├── mitigation_type: "code_fix" | "data_optimization" | "skills_update" | "none"
├── skills_update?: string
└── iteration_complete: boolean
```

---

## Quickstart

Requires **Node.js 26** (`nvm use` picks it up from `.nvmrc`).

```bash
# 1. Clone and install
git clone https://github.com/victusfate/agent-verse
cd agent-verse
nvm install   # installs Node 26.2.0 from .nvmrc
npm install

# 2. Configure credentials
cp .env.example .env
# edit .env — set at least one provider key

# 3. Run with defaults (Claude Sonnet 4.6)
npm start

# 4. Supply a seed idea
npm start -- --seed "AI invoice reconciliation API for SMBs"

# 5. Use a different model
npm start -- --model gpt-4o-mini
npm start -- --model gemini-2.5-flash
npm start -- --model llama3.2        # requires local Ollama daemon

# 6. Limit cycles
npm start -- --max-cycles 2
```

---

## Development

```bash
npm run dev          # watch mode (tsx --watch)
npm test             # Vitest test suite
npm run typecheck    # tsc validation (no emit)
```

Tests live in `src/__tests__/` and cover schemas, graph state machine, ledger ops, brain read/write, provider detection, JSON parsing, and operator execution — all with mocked LLM clients.

The `/feature-chain` skill drives the full design → PRD → TDD → review loop.
<!-- BEGIN_SKILLS_INVOCATION -->
Skills can also be invoked individually: `/feature-chain`, `/grill-with-docs`, `/to-prd`, `/tdd`, `/design-review`, `/code-quality-review`, `/skillify`, `/sync-scaffold`, `/create-pr`, `/code-review`, `/simplify`, `/prune`, `/pause`, `/resume`.
<!-- END_SKILLS_INVOCATION -->

---

## Key Design Principles

**Total Legibility** — every event writes to the ledger. Nothing happens off-book.

**Ephemeral Software** — `companies/` is runtime state. `src/` is the durable asset. Delete the companies folder to reset; the code survives.

**Human-at-the-Edge** — agents auto-escalate `high` and `critical` risk tasks. Humans only intervene at those gates.

**Minimum Viable Autonomy** — the system does the most with the least human contact, but never crosses a risk tier without permission.

---

## Project Structure

<!-- BEGIN_SKILLS_STRUCTURE -->
```
AGENTS.md                        # agent instructions — single source of truth
CLAUDE.md                        # imports AGENTS.md (@AGENTS.md)
GEMINI.md                        # references AGENTS.md
bin/
  bootstrap.sh                   # one-time setup for downstream repos
  sync-from-scaffold.sh          # pull scaffold updates into a downstream repo
.claude/
  skills/
    RESOLVER.md                   # central routing table — skill → regex → path
    feature-chain/SKILL.md        # Orchestrate design → PRD → TDD → review end to end
    grill-with-docs/SKILL.md      # Design Q&A → design.md + canonical vocabulary
    to-prd/SKILL.md               # Synthesize context + codebase → prd.md
    tdd/SKILL.md                  # Vertical-slice TDD → plan.md + tdd-log.md
    design-review/SKILL.md        # Structural review of design.md
    code-quality-review/SKILL.md  # Structural review of implementation
    skillify/SKILL.md             # Capture a completed session as a reusable skill + PR to scaffold
    sync-scaffold/SKILL.md        # Bootstrap scaffold into a repo or sync an existing one from upstream
    create-pr/SKILL.md            # Create a PR for the current branch and immediately subscribe to its activity
    code-review/SKILL.md          # Review current diff for correctness bugs and quality issues at a configurable effort level
    simplify/SKILL.md             # Apply reuse, simplification, efficiency, and altitude cleanups to changed code
    prune/SKILL.md                # Run all quality review skills and funnel findings into design→PRD→TDD→PR
    pause/SKILL.md                # Checkpoint the session into git — write a handoff, commit work in flight, and push so any device can resume
    resume/SKILL.md               # Reload a checkpointed session from the pushed handoff and continue from its next steps, cold or cross-device
  session-start/
    hook.sh                      # SessionStart hook: fetches origin/main, warns if branch is behind
  read-once/
    hook.sh                      # PreToolUse hook: skips redundant file reads
    compact.sh                   # PostCompact hook: clears read cache after compaction
  settings.json                  # hook wiring (SessionStart, PreToolUse, PostCompact)
.cursor/
  rules/
    agents.mdc               # thin pointer to AGENTS.md
    feature-chain.mdc        # mirrors feature-chain for Cursor
    grill-with-docs.mdc      # mirrors grill-with-docs for Cursor
    to-prd.mdc               # mirrors to-prd for Cursor
    tdd.mdc                  # mirrors tdd for Cursor
    design-review.mdc        # mirrors design-review for Cursor
    code-quality-review.mdc  # mirrors code-quality-review for Cursor
    skillify.mdc             # mirrors skillify for Cursor
    sync-scaffold.mdc        # mirrors sync-scaffold for Cursor
    create-pr.mdc            # mirrors create-pr for Cursor
    code-review.mdc          # mirrors code-review for Cursor
    simplify.mdc             # mirrors simplify for Cursor
    prune.mdc                # mirrors prune for Cursor
    pause.mdc                # mirrors pause for Cursor
    resume.mdc               # mirrors resume for Cursor
.agents/
  skills/
    feature-chain/SKILL.md        # Orchestrate design → PRD → TDD → review end to end
    grill-with-docs/SKILL.md      # Design Q&A → design.md + canonical vocabulary
    to-prd/SKILL.md               # Synthesize context + codebase → prd.md
    tdd/SKILL.md                  # Vertical-slice TDD → plan.md + tdd-log.md
    design-review/SKILL.md        # Structural review of design.md
    code-quality-review/SKILL.md  # Structural review of implementation
    skillify/SKILL.md             # Capture a completed session as a reusable skill + PR to scaffold
    sync-scaffold/SKILL.md        # Bootstrap scaffold into a repo or sync an existing one from upstream
    create-pr/SKILL.md            # Create a PR for the current branch and immediately subscribe to its activity
    code-review/SKILL.md          # Review current diff for correctness bugs and quality issues at a configurable effort level
    simplify/SKILL.md             # Apply reuse, simplification, efficiency, and altitude cleanups to changed code
    prune/SKILL.md                # Run all quality review skills and funnel findings into design→PRD→TDD→PR
    pause/SKILL.md                # Checkpoint the session into git — write a handoff, commit work in flight, and push so any device can resume
    resume/SKILL.md               # Reload a checkpointed session from the pushed handoff and continue from its next steps, cold or cross-device
.agent/
  rules/
    agents.md               # thin pointer to AGENTS.md (always-on)
  workflows/
    feature-chain.md        # Orchestrate design → PRD → TDD → review end to end
    grill-with-docs.md      # Design Q&A → design.md + canonical vocabulary
    to-prd.md               # Synthesize context + codebase → prd.md
    tdd.md                  # Vertical-slice TDD → plan.md + tdd-log.md
    design-review.md        # Structural review of design.md
    code-quality-review.md  # Structural review of implementation
    skillify.md             # Capture a completed session as a reusable skill + PR to scaffold
    sync-scaffold.md        # Bootstrap scaffold into a repo or sync an existing one from upstream
    create-pr.md            # Create a PR for the current branch and immediately subscribe to its activity
    code-review.md          # Review current diff for correctness bugs and quality issues at a configurable effort level
    simplify.md             # Apply reuse, simplification, efficiency, and altitude cleanups to changed code
    prune.md                # Run all quality review skills and funnel findings into design→PRD→TDD→PR
    pause.md                # Checkpoint the session into git — write a handoff, commit work in flight, and push so any device can resume
    resume.md               # Reload a checkpointed session from the pushed handoff and continue from its next steps, cold or cross-device
scripts/
  check-resolvable.mjs           # RESOLVER linter (reachability/ambiguity/DRY/MECE/cursor/antigravity/sync)
  update-readme-skills.mjs       # regenerate README.md skill sections from RESOLVER.md
.githooks/
  pre-commit                     # runs the linter and README freshness check — enable via core.hooksPath
.github/
  scaffold-files.txt             # manifest of files managed by scaffold
  workflows/
    sync-scaffold.yml            # manual workflow to sync updates via PR
.claudeignore                    # excludes build artifacts from Claude's context
```
<!-- END_SKILLS_STRUCTURE -->
