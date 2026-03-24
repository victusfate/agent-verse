# Hierarchical Agent System — Planning Blueprint

## 1) Goal & Scope
Design an open-source MIT-licensed library for **hierarchical multi-agent orchestration** that can scale from:
- Top-level orchestrator (main agent)
- Mid-level domain agents
- Deep specialized agents/tools

This document is planning-only and defines architecture, protocols, safety controls, and a practical roadmap.

---

## 2) Language Decision (Recommendation)

### Recommended v1: **TypeScript**
Why:
- Fast iteration + broad OSS adoption.
- Excellent interoperability with LLM/agent ecosystems and MCP tools.
- Strong type system for contracts between agent levels.
- Easy path to admin dashboard (Node + web UI).

### Potential v2 runtime core: **Rust**
Why:
- High performance and memory safety.
- Good for long-lived orchestration daemons and high-concurrency execution.
- Could be introduced as optional “execution engine” while preserving TS API.

### Where Python / Elixir fit
- **Python**: plugin ecosystem and ML tooling; useful for adapters.
- **Elixir**: compelling for actor model and fault tolerance; could inspire supervision tree semantics even if not chosen first.

**Decision proposal:**
- Build v1 fully in TypeScript.
- Keep protocol and state model language-agnostic so Rust/Elixir runtimes can be added later.

---

## 3) Core System Model

## 3.1 Agent hierarchy
- **L0 Orchestrator**: owns global objective, budget, policy constraints.
- **L1 Coordinators**: decompose into sub-goals by domain (research, coding, QA, ops).
- **L2+ Specialists**: execute focused tasks (retrieval, schema migration, MCP calls, etc).

Each agent node has:
- `agent_id`, `parent_id`, `session_id`
- `capabilities`
- `policy envelope` (budget, depth, tools, auth scope)
- `state snapshot ref`

## 3.2 Message-based communication
Use an internal typed event bus (local in-process first, pluggable queue later).

Message envelope:
- `message_id` (UUID)
- `causation_id` (which message triggered this)
- `correlation_id` (same task lineage)
- `sender_agent_id`, `receiver_agent_id`
- `intent` (`plan`, `delegate`, `ask`, `result`, `escalate`, `halt`)
- `payload` (typed by intent)
- `idempotency_key`
- `ttl_hops` + `expires_at`
- `created_at`

Semantics:
- At-least-once delivery + dedupe by `idempotency_key`.
- Mandatory ACK for task delegation.
- Result messages include confidence and evidence references.

---

## 4) Memory Architecture

Use a **three-tier memory model**:

1. **Ephemeral Working Memory** (per agent invocation)
   - Prompt context, current plan, current tool outputs.
   - Strict token budget and truncation policy.

2. **Session Memory** (per objective/session)
   - Task graph, decisions, outputs, failures, approvals.
   - Summarized periodically into checkpoints.

3. **Long-Term Memory** (cross-session)
   - Facts, learned policies, reusable playbooks, embeddings.
   - Optional and policy-gated by tenant/org.

Memory operations should be explicit events:
- `memory.write`, `memory.read`, `memory.summarize`, `memory.redact`

Controls:
- PII tagging + configurable retention windows.
- Provenance on every write (source message/tool).
- Hashing and versioning for deterministic replay.

---

## 5) Auth & Security Model

Principles:
- Least privilege by default.
- Delegation should narrow scope, never broaden.
- Every tool call should be attributable to principal + agent.

Proposed structure:
- **Principal token** (human/system identity)
- **Session token** (objective-level scope)
- **Agent capability token** (fine-grained sub-scope)

Mechanics:
- Capability-based auth for tools/MCP servers.
- Signed delegation grants with expiry + audience restriction.
- Deny-by-default policy engine for tool and memory access.
- Audit event on every auth decision.

---

## 6) MCP + Skill Integration

Treat MCP and skills as first-class capabilities.

### MCP adapter contract
- `discover(server)`
- `list_resources(server)`
- `read_resource(uri)`
- `invoke_tool(tool_name, input, auth_context)`

### Skill contract
- Skill descriptor: name, trigger predicates, required capabilities, expected outputs.
- Runtime should choose skills via policy + planner, not only prompt heuristics.
- Skill runs are observable nodes in task graph.

Safety:
- MCP/skill execution sandbox profiles.
- Output validation schemas.
- Circuit breakers for failing tools.

---

## 7) Recursion, Loop Prevention & Budgeting

To avoid infinite loops and token exhaustion:

Hard limits:
- `max_depth` per session.
- `max_children` per node.
- `max_turns` per objective.
- `max_tokens_total` and per-agent token quotas.

Loop detection:
- State fingerprinting on `(goal, context_summary, tool_sequence)`.
- Detect repeated fingerprints over window N and force escalation.
- Cycle checks in task DAG (no parent re-entry without explicit policy).

Adaptive policies:
- If confidence decreasing over k iterations -> stop/delegate/escalate.
- If marginal utility of new info below threshold -> summarize and return.

Escalation:
- Standard `escalate` message with reason codes:
  - `insufficient_context`
  - `policy_blocked`
  - `budget_exhausted`
  - `uncertain_result`
  - `external_dependency_failure`
- Escalation target: human manager or external orchestrator.

---

## 8) Idempotent Observation System + Admin Dashboard

Adopt event-sourcing:
- All state transitions are append-only events.
- Materialized views drive live UI and analytics.

Idempotency:
- Every command/event has deterministic key.
- Consumers keep processed-key store.
- Replays rebuild same state snapshots.

Suggested event types:
- `session.created`
- `goal.decomposed`
- `task.delegated`
- `task.started`
- `tool.called`
- `tool.result`
- `memory.updated`
- `policy.denied`
- `agent.escalated`
- `task.completed`
- `session.completed`

Admin dashboard (v1):
- DAG view of agent hierarchy + state badges.
- Timeline of events with filters by session/agent/tool.
- Budget panel: token/cost/time consumption.
- Escalation inbox for human approvals.
- Replay mode for postmortems.

Implementation note:
- Keep domain model UI-agnostic; expose GraphQL/REST + websocket stream.

---

## 9) Existing Libraries & Ecosystem Review (Initial)

### Frameworks/orchestrators
- **LangGraph**: strong graph-based orchestration and durable execution concepts.
- **AutoGen**: multi-agent conversational patterns; useful delegation ideas.
- **CrewAI**: role-based agent collaboration ergonomics.
- **Semantic Kernel**: planner + connector abstraction with enterprise orientation.
- **OpenAI Agents SDK**: agent/tool abstractions and tracing direction.

### Workflow engines to learn from
- **Temporal**: durable workflows, retries, idempotency patterns.
- **Prefect / Dagster**: orchestration, observability, task state modeling.

### Observability references
- OpenTelemetry traces/metrics/log correlations.
- Event-store patterns (Kafka/NATS/EventStoreDB style semantics).

### Gaps this project can fill
- Unified hierarchical recursion controls + budget governance.
- Native MCP + skill capability mediation with auth envelopes.
- Deterministic replay and idempotent state reconstruction tuned for agents.

---

## 10) Proposed OSS Architecture (TypeScript v1)

Packages:
- `@agentverse/core` — agent model, planner interfaces, policies.
- `@agentverse/runtime` — execution loop, delegation engine, recursion guards.
- `@agentverse/memory` — memory adapters + summarization policies.
- `@agentverse/auth` — capability tokens and policy checks.
- `@agentverse/mcp` — MCP adapters and tool contracts.
- `@agentverse/observability` — event model, tracing, metrics.
- `@agentverse/dashboard` — admin UI.

Storage abstraction interfaces:
- Event store (append/read by stream)
- State snapshot store
- Vector store
- KV dedupe/idempotency store

---

## 11) Minimal Viable Milestones

### Milestone 0 — RFC + contracts
- Define message schema and task DAG model.
- Define event taxonomy and idempotency semantics.
- Define auth capability model.

### Milestone 1 — Core runtime
- Single-process orchestrator + 2-level delegation.
- Recursion/budget guards.
- Basic memory tiers (ephemeral + session).

### Milestone 2 — MCP/skill integration
- At least one MCP server adapter.
- Skill registry + typed execution contracts.

### Milestone 3 — Observability
- Event stream + materialized views.
- Simple dashboard (hierarchy + timeline + budgets).

### Milestone 4 — Human-in-the-loop
- Escalation queue and approval workflows.
- Resume/retry semantics.

---

## 12) Open Questions
- How strict should determinism be across LLM model versions?
- Should delegation policy be static config, learned, or hybrid?
- What is the default trust policy for third-party MCP servers?
- Which persistence backend should be default for local development?

---

## 13) Practical Next Step
Create an RFC repository skeleton with:
1. Protocol schema (`messages`, `events`, `policies`).
2. Runtime execution state machine.
3. One end-to-end demo: orchestrator -> specialist -> MCP tool -> result -> dashboard event trail.


---

## 14) Existing Library Deep-Dive (Decision Matrix)

| Library | Strengths | Weaknesses / Risks | What to Borrow |
|---|---|---|---|
| LangGraph | Durable graph execution, checkpointed state, clear node/edge mental model | Python-first ecosystem, custom graph abstractions may feel heavyweight for simple flows | DAG/task state model, resume/replay semantics |
| AutoGen | Multi-agent conversation ergonomics, easy role simulation | Less deterministic by default, conversation loops can grow quickly without strict policy | Agent role contracts, delegated conversation patterns |
| CrewAI | Role/task abstraction is approachable for product teams | Governance and low-level observability often need extra work | Team/role UX and task assignment ergonomics |
| Semantic Kernel | Connector/plugin model, enterprise alignment, planning integration | Cross-language feature parity can vary; planner behavior can be opaque | Connector contracts and policy-oriented plugin access |
| OpenAI Agents SDK | Clear tool usage + tracing direction; modern agent abstractions | Vendor coupling if not abstracted; evolving APIs | Tool tracing model, run lifecycle structure |
| Temporal | Gold-standard durable workflows and retries | Operational complexity and learning curve for small teams | Deterministic workflow + retry/idempotency patterns |

**Recommendation for v1 implementation stack:**
- Runtime patterns inspired by **Temporal** (idempotency/retry discipline).
- Agent graph and resume semantics inspired by **LangGraph**.
- Trace model aligned with **OpenAI Agents SDK** style run lifecycle.
- Keep provider/tool abstraction neutral to avoid lock-in.

---

## 15) Concrete v1 Defaults (so implementation can start quickly)

### Runtime defaults
- `max_depth = 4`
- `max_children_per_node = 6`
- `max_turns = 40`
- `max_tokens_total = 250_000`
- `escalation_on_repeat_fingerprint = 3`

### Reliability defaults
- Retry policy: exponential backoff (`base=250ms`, `max=8s`, `attempts=4`).
- Tool timeout default: `30s` (override per tool profile).
- Circuit breaker: open after 5 failures in 60s, half-open after 30s.

### Storage defaults (local dev)
- Event store: SQLite append-only table.
- Snapshot store: JSON blobs on filesystem.
- Dedupe/idempotency store: SQLite key-value table with TTL.
- Vector store: in-memory adapter by default, pluggable provider in production.

### Human-in-the-loop defaults
- Auto-escalate at 80% budget burn with low confidence.
- Require manager approval for:
  - privileged MCP tools,
  - cross-tenant memory reads,
  - policy override requests.

These are defaults, not fixed policy; all values should be overrideable at session and tenant scopes.

---

## 16) External Article Synthesis (March 2026)

### A) ClawTeam implementation walkthrough (MarkTechPost, March 20, 2026)
Key ideas worth carrying forward:
- **Leader + specialists pattern is operationally practical**: a leader decomposes a high-level goal into 3–5 concrete tasks with role assignments and explicit dependencies.
- **Shared task board as system-of-record**: task lifecycle (`pending`, `blocked`, `in_progress`, `completed`, `failed`) and dependency unblocking are treated as first-class runtime mechanics.
- **Function-calling as execution ABI**: tools like `task_update`, `inbox_send`, `inbox_receive`, and `task_list` form a stable action surface between agents and runtime.
- **Inbox messaging model**: direct and broadcast communication between agents provides low-friction coordination.
- **Live operator visibility**: a Kanban/roster-style dashboard and final leader synthesis make multi-agent behavior reviewable.
- **Infra-light reproducibility**: core swarm patterns can run without heavyweight process infrastructure, which is useful for quick onboarding and local demos.

### B) Reliability/testing for autonomous agents (VentureBeat, March 22, 2026)
Key ideas worth carrying forward:
- **Layered reliability over prompt-only optimism**:
  1. Model/prompt quality,
  2. Deterministic validation guardrails,
  3. Confidence/uncertainty routing,
  4. Full observability/auditability.
- **Graduated autonomy**: start read-only and low-risk actions first; require approval for higher-risk actions.
- **Action-cost budgets**: treat actions as risk/cost-weighted operations with per-agent/session budget throttles.
- **Operational boundaries**: hard limits on retries, rate, tokens, and side effects to prevent runaway loops.
- **Agent-specific testing strategy**: simulation at scale, adversarial red teaming, and shadow mode before autonomous launch.
- **Explicit HITL modes**: human-on-the-loop (monitor), human-in-the-loop (approve), human-with-the-loop (collaborative).
- **Failure taxonomy + recovery**: recoverable vs detectable vs undetectable failures; use audit sampling to catch silent drift.

---

## 17) Adaptations to this plan (to implement those ideas)

### 17.1 Protocol and runtime additions
- Add `task.status.changed` and `task.unblocked` as required event types.
- Add a typed **TaskBoard API** in `@agentverse/core` with dependency DAG semantics and deterministic unblocking.
- Add a minimal **Inbox API** (`send`, `broadcast`, `receive`, `peek`) with per-agent queue metrics.
- Add an explicit tool ABI profile for swarm-control actions (`task_update`, `task_list`, `inbox_send`, `inbox_receive`).

### 17.2 Risk-aware autonomy controls
- Introduce a **risk tier** per tool/action (`low`, `medium`, `high`, `critical`) and map to default enforcement:
  - `low`: autonomous,
  - `medium`: conditional confidence gate,
  - `high/critical`: manager approval required.
- Add **action cost units** and per-session/per-agent budgets with events:
  - `budget.consumed`, `budget.threshold_reached`, `budget.exhausted`.
- Extend escalation reasons with:
  - `risk_gate_blocked`,
  - `confidence_below_threshold`,
  - `rate_limit_exceeded`.

### 17.3 Reliability pipeline hardening
- Require schema validation for every tool call proposal before execution.
- Add confidence band routing defaults:
  - High confidence: auto-execute,
  - Medium confidence: queue for review,
  - Low confidence: block + explain.
- Capture richer trace metadata by default:
  - prompt/context hash,
  - tool arguments/result hashes,
  - model + temperature,
  - policy decisions.

### 17.4 Test strategy milestone (new)
Add **Milestone 1.5 — Reliability Qualification** between current Milestones 1 and 2:
- Simulation harness with at least 100 seeded scenarios per policy change.
- Red-team suite (prompt injection, boundary bypass, dependency deadlock, retry storms).
- Shadow mode runner that compares agent-proposed actions vs human-selected actions.
- Reliability scorecard: task success rate, unsafe-action catch rate, false-positive block rate, mean time to escalation.

### 17.5 Dashboard upgrades (v1.1 scope)
- Add **Autonomy Mode Panel** showing current mode per agent (on/in/with-the-loop).
- Add **Risk/Budget Timeline** with action-cost burn visualization.
- Add **Failure Mode Lens** classifying incidents as recoverable/detectable/undetectable.
- Add sampled audit queue for periodic human review of “successful” autonomous actions.

### 17.6 Immediate implementation sequence update
1. Start with Milestone 0 contracts plus TaskBoard + Inbox interfaces.
2. Implement Milestone 1 runtime with deterministic guardrails + risk tiers + action-cost budgets.
3. Complete Milestone 1.5 reliability qualification before broad MCP expansion.
4. Proceed to Milestone 2 MCP/skills with the same risk and validation envelopes.
