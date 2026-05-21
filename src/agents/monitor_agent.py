"""Phase 4 — Monitor-Agent: continuous self-improvement engine.

Task 4.1 — Friction Profiling:   scan telemetry for failures and drop-offs.
Task 4.2 — Root-Cause Diagnosis: LLM-powered friction classification.
Task 4.3 — Code/DB Hot-fix:      (stub — would open a PR in production).
Task 4.4 — Brain Synthesis:      rewrites skills.md with learned improvements.
"""
from __future__ import annotations

import json

from src import company_brain, ledger
from src.llm import call_tool
from src.schemas import MonitorReport, OperatorTask

DIAGNOSIS_TOOL = {
    "name": "submit_diagnosis",
    "description": "Submit the root-cause diagnosis and recommended mitigation.",
    "parameters": {
        "type": "object",
        "properties": {
            "friction_summary": {
                "type": "string",
                "description": "Plain-English summary of all identified friction points.",
            },
            "mitigation_type": {
                "type": "string",
                "enum": ["code_fix", "data_optimization", "skills_update", "none"],
            },
            "skills_update": {
                "type": "string",
                "description": "Complete replacement content for skills.md (only if mitigation_type=skills_update).",
            },
            "iteration_complete": {
                "type": "boolean",
                "description": "True if the system has reached a satisfactory state and should halt.",
            },
        },
        "required": ["friction_summary", "mitigation_type", "iteration_complete"],
    },
}

SYSTEM_PROMPT = """You are the Monitor-Agent — an asynchronous supervisory intelligence.

Your role is to:
1. Analyse telemetry and task results to identify friction (failures, low-confidence outputs, quality gate failures).
2. Diagnose the root cause and classify it as code_fix, data_optimization, skills_update, or none.
3. If the fix is skills_update, rewrite the entire skills.md with improvements learned from this cycle.
4. Decide if the system has accomplished enough to halt for this venture cycle.

Be specific. If skills need updating, include concrete new playbooks, API examples, or operational rules."""


def run(company_id: str, tasks: list[OperatorTask], cycle: int) -> MonitorReport:
    """Analyse telemetry from completed operator tasks and produce a diagnosis."""
    print(f"\n[Monitor-Agent] Starting friction profiling (cycle {cycle})...")

    # Task 4.1 — gather friction data
    failures = ledger.query_failures(company_id)

    task_summaries = []
    for t in tasks:
        task_summaries.append({
            "task_id": t.task_id[:8],
            "role": t.role,
            "status": t.status,
            "error": t.error,
            "result_preview": (t.result or "")[:200],
        })

    current_skills = company_brain.read_skills(company_id)
    friction_count = len(failures)
    completed_count = sum(1 for t in tasks if t.status == "completed")
    print(f"[Monitor-Agent] Tasks: {completed_count}/{len(tasks)} completed, {friction_count} friction events")

    analysis_payload = json.dumps({
        "cycle": cycle,
        "task_summaries": task_summaries,
        "failure_count": friction_count,
        "failure_samples": failures[:5],
        "current_skills_preview": current_skills[:1000],
    }, indent=2, default=str)

    # Task 4.2 — root-cause diagnosis
    inp = call_tool(
        system=SYSTEM_PROMPT,
        user=(
            f"Analyse this execution cycle and diagnose any friction:\n\n"
            f"{analysis_payload}\n\n"
            f"Cycle {cycle}: {'All tasks succeeded.' if friction_count == 0 else f'{friction_count} failures detected.'} "
            f"Mark iteration_complete=true if the venture milestone is substantially achieved."
        ),
        tool=DIAGNOSIS_TOOL,
        max_tokens=3000,
    )

    report = MonitorReport(
        company_id=company_id,
        cycle=cycle,
        friction_points=failures[:10],
        diagnosis=inp["friction_summary"],
        mitigation_type=inp["mitigation_type"],
        skills_update=inp.get("skills_update"),
        iteration_complete=inp.get("iteration_complete", False),
    )

    ledger.record(
        company_id=company_id,
        event_type="monitor.report",
        agent_type="monitor",
        payload=report.model_dump(),
    )

    # Task 4.4 — update Company Brain if needed
    if report.mitigation_type == "skills_update" and report.skills_update:
        company_brain.write_skills(company_id, report.skills_update)
        print(f"[Monitor-Agent] ✓ skills.md updated ({len(report.skills_update)} chars)")
        ledger.record(company_id, "company.brain.skills_updated",
                      {"cycle": cycle, "chars": len(report.skills_update)}, "monitor")

    # Task 4.3 — code hot-fix stub
    if report.mitigation_type == "code_fix":
        print("[Monitor-Agent] ⚙ Code hot-fix required — opening sub-agent (stub in this env)")
        ledger.record(company_id, "monitor.hotfix_stub",
                      {"cycle": cycle, "diagnosis": report.diagnosis[:200]}, "monitor")

    status = "COMPLETE" if report.iteration_complete else "CONTINUING"
    print(f"[Monitor-Agent] Diagnosis: {report.mitigation_type} | Iteration: {status}")
    return report
