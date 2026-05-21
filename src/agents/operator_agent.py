"""Phase 3 — Operator-Agent: 5-layer recursive execution loop.

Layer 1 — SENSOR:       Ingests the task from the shared state.
Layer 2 — POLICY:       Evaluates risk; escalates high/critical to human gate.
Layer 3 — TOOL:         Executes deterministic work via LLM completion.
Layer 4 — QUALITY GATE: Validates output structure and content.
Layer 5 — LEARNING:     Packages the full invocation stack and writes telemetry.
"""
from __future__ import annotations

from typing import Any

from src import company_brain, ledger
from src.llm import call_tool
from src.schemas import OperatorTask, PolicyDecision, QualityGateResult, TelemetryEntry

EXECUTE_TOOL = {
    "name": "execute_task",
    "description": "Execute the assigned operator task and return a structured result.",
    "parameters": {
        "type": "object",
        "properties": {
            "deliverable": {
                "type": "string",
                "description": "The complete, concrete output of the task.",
            },
            "artifacts": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of artifacts produced (file paths, URLs, schema names, etc.)",
            },
            "confidence": {
                "type": "number",
                "description": "Self-assessed confidence 0.0-1.0 that the output fully satisfies the task.",
            },
            "next_actions": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Recommended follow-up actions for other agents.",
            },
        },
        "required": ["deliverable", "artifacts", "confidence", "next_actions"],
    },
}

POLICY_TOOL = {
    "name": "policy_decision",
    "description": "Evaluate the task against company policy and return a risk decision.",
    "parameters": {
        "type": "object",
        "properties": {
            "allowed": {"type": "boolean"},
            "risk_tier": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
            "reason": {"type": "string"},
            "escalate_to_human": {"type": "boolean"},
        },
        "required": ["allowed", "risk_tier", "reason", "escalate_to_human"],
    },
}


# ---------- Layer 2: Policy ----------

def _policy_check(task: OperatorTask, skills: str) -> PolicyDecision:
    context = company_brain.read_context_framework(task.company_id)
    budget_remaining = context.get("token_budget_usd", 50.0) - context.get("tokens_consumed_usd", 0.0)

    system = (
        "You are a Policy-Layer agent. Evaluate the task against company constraints.\n"
        "Rules:\n"
        "- Financial actions above $100 are CRITICAL\n"
        "- External API mutations are HIGH risk\n"
        "- Read-only or generative tasks are LOW risk\n"
        "- Escalate to human if risk is HIGH or CRITICAL\n"
        f"- Remaining token budget: ${budget_remaining:.2f} USD"
    )
    args = call_tool(
        system=system,
        user=f"Evaluate task:\n{task.description}",
        tool=POLICY_TOOL,
        max_tokens=512,
    )
    return PolicyDecision(**args)


# ---------- Layer 3: Tool Execution ----------

def _execute(task: OperatorTask, skills: str, context_framework: dict) -> dict[str, Any]:
    role_context = {
        "product": "You are the Product-Agent. Produce product specs, user stories, and go-to-market copy.",
        "engineering": "You are the Engineering-Agent. Write code, API schemas, database queries, and technical specs.",
        "customer-success": "You are the Customer-Success-Agent. Write onboarding flows, email sequences, and support playbooks.",
    }
    system = (
        f"{role_context.get(task.role, 'You are an Operator-Agent.')}\n\n"
        f"Company context:\n{context_framework.get('mission', '')}\n\n"
        f"Company skills:\n{skills[:2000]}\n\n"
        "Use the execute_task tool to return your deliverable."
    )
    return call_tool(
        system=system,
        user=f"Execute this task:\n\n{task.description}",
        tool=EXECUTE_TOOL,
        max_tokens=2048,
    )


# ---------- Layer 4: Quality Gate ----------

def _quality_gate(task: OperatorTask, tool_output: dict[str, Any]) -> QualityGateResult:
    issues = []
    deliverable = tool_output.get("deliverable", "")
    confidence = tool_output.get("confidence", 0.0)

    if not deliverable or len(deliverable) < 20:
        issues.append("Deliverable is empty or too short")
    if confidence < 0.3:
        issues.append(f"Low confidence score: {confidence:.2f}")
    if not tool_output.get("artifacts"):
        issues.append("No artifacts listed")

    passed = len(issues) == 0
    return QualityGateResult(
        passed=passed,
        issues=issues,
        validated_output=deliverable if passed else None,
    )


# ---------- Main Runner ----------

def run(task: OperatorTask) -> OperatorTask:
    """Execute one operator task through all 5 layers. Returns updated task."""
    telemetry_stack: list[TelemetryEntry] = []

    def _telem(layer: str, data: dict, success: bool, error: str | None = None):
        entry = TelemetryEntry(
            company_id=task.company_id,
            task_id=task.task_id,
            agent_role=task.role,
            layer=layer,
            data=data,
            success=success,
            error=error,
        )
        telemetry_stack.append(entry)
        ledger.record(
            company_id=task.company_id,
            event_type="telemetry",
            agent_type=f"operator.{task.role}",
            payload=entry.model_dump(),
        )

    print(f"\n[Operator:{task.role}] Starting task {task.task_id[:8]}...")

    # ── Layer 1: SENSOR ──────────────────────────────────────────────────────
    task.status = "in_progress"
    ledger.record(task.company_id, "task.started", {"task_id": task.task_id}, f"operator.{task.role}")
    _telem("sensor", {"task": task.model_dump()}, True)
    print(f"[Operator:{task.role}] L1-Sensor ✓")

    # ── Layer 2: POLICY ──────────────────────────────────────────────────────
    skills = company_brain.read_skills(task.company_id)
    try:
        policy = _policy_check(task, skills)
        _telem("policy", policy.model_dump(), policy.allowed,
               None if policy.allowed else "policy blocked")
        print(f"[Operator:{task.role}] L2-Policy ✓  risk={policy.risk_tier} allowed={policy.allowed}")

        if policy.escalate_to_human:
            print(f"[Operator:{task.role}] ⚠ Human escalation required (risk={policy.risk_tier})")
            ledger.record(task.company_id, "human.escalation_required",
                          {"task_id": task.task_id, "reason": policy.reason}, f"operator.{task.role}")

        if not policy.allowed:
            task.status = "blocked"
            task.error = f"Policy blocked: {policy.reason}"
            _telem("learning", {"blocked": True}, False, task.error)
            return task
    except Exception as e:
        _telem("policy", {}, False, str(e))
        print(f"[Operator:{task.role}] L2-Policy ✗  {e}")

    # ── Layer 3: TOOL ────────────────────────────────────────────────────────
    context_framework = company_brain.read_context_framework(task.company_id)
    try:
        tool_output = _execute(task, skills, context_framework)
        _telem("tool", tool_output, bool(tool_output.get("deliverable")))
        print(f"[Operator:{task.role}] L3-Tool    ✓  confidence={tool_output.get('confidence', 0):.2f}")
    except Exception as e:
        task.status = "failed"
        task.error = f"Tool execution failed: {e}"
        _telem("tool", {}, False, str(e))
        _telem("learning", {"failed": True}, False, str(e))
        print(f"[Operator:{task.role}] L3-Tool    ✗  {e}")
        return task

    # ── Layer 4: QUALITY GATE ────────────────────────────────────────────────
    qg = _quality_gate(task, tool_output)
    _telem("quality_gate", {"passed": qg.passed, "issues": qg.issues}, qg.passed,
           "; ".join(qg.issues) if not qg.passed else None)
    if qg.passed:
        print(f"[Operator:{task.role}] L4-QGate   ✓")
    else:
        print(f"[Operator:{task.role}] L4-QGate   ✗  {qg.issues}")
        task.status = "failed"
        task.error = "Quality gate failure: " + "; ".join(qg.issues)
        _telem("learning", {"qg_failed": True, "issues": qg.issues}, False)
        return task

    # ── Layer 5: LEARNING ────────────────────────────────────────────────────
    task.result = qg.validated_output
    task.status = "completed"
    summary = {
        "layers_executed": 5,
        "confidence": tool_output.get("confidence"),
        "artifacts": tool_output.get("artifacts", []),
        "next_actions": tool_output.get("next_actions", []),
    }
    _telem("learning", summary, True)
    company_brain.append_task_log(task.company_id, task.task_id, {
        "task": task.model_dump(),
        "tool_output": tool_output,
        "telemetry_count": len(telemetry_stack),
    })
    ledger.record(task.company_id, "task.completed",
                  {"task_id": task.task_id, "role": task.role}, f"operator.{task.role}")
    print(f"[Operator:{task.role}] L5-Learn   ✓  → task COMPLETED")
    return task
