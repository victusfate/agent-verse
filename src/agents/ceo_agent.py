"""Phase 2 — CEO-Agent: executive orchestrator."""
from __future__ import annotations

import json
import re

from src import company_brain, ledger
from src.llm import call_tool
from src.schemas import OperatorTask, VenturePayload

BRAIN_TOOL = {
    "name": "initialise_company_brain",
    "description": "Write the initial context_framework and skills baseline for the new company.",
    "parameters": {
        "type": "object",
        "properties": {
            "context_framework": {
                "type": "object",
                "description": "Structured JSON describing company mission, constraints, and capabilities.",
            },
            "skills_md": {
                "type": "string",
                "description": "Markdown document listing the company's operational skills and playbooks.",
            },
            "operator_tasks": {
                "type": "array",
                "description": "Initial task list — exactly one for Product, Engineering, and Customer-Success.",
                "items": {
                    "type": "object",
                    "properties": {
                        "role": {
                            "type": "string",
                            "enum": ["product", "engineering", "customer-success"],
                        },
                        "description": {"type": "string"},
                        "risk_tier": {
                            "type": "string",
                            "enum": ["low", "medium", "high", "critical"],
                        },
                    },
                    "required": ["role", "description", "risk_tier"],
                },
            },
        },
        "required": ["context_framework", "skills_md", "operator_tasks"],
    },
}

SYSTEM_PROMPT = """You are the CEO-Agent of an autonomous corporate AI ecosystem.

You have received a validated venture payload. Your job is to:
1. Write a structured context_framework that will be injected into every operator agent's context window.
2. Write an initial skills.md document listing the company's core competencies, APIs to use, and operational playbooks.
3. Provision exactly three operator tasks — one for Product, one for Engineering, one for Customer-Success — that together deliver the venture's first milestone.

Be specific and actionable. Each task description should be a complete, executable work order."""


def run(venture: VenturePayload) -> tuple[str, list[OperatorTask]]:
    """Initialise the company and return (company_id, operator_tasks)."""
    company_id = re.sub(r"[^a-z0-9-]", "-", venture.company_name.lower())[:40]
    print(f"[CEO-Agent] Provisioning company: {company_id}")

    # Task 2.1 — initialise the datastore
    ledger.init_ledger()
    ledger.record(
        company_id=company_id,
        event_type="company.created",
        agent_type="ceo",
        payload={"venture": venture.model_dump()},
    )

    venture_summary = json.dumps(venture.model_dump(), indent=2)
    inp = call_tool(
        system=SYSTEM_PROMPT,
        user=f"Initialise company for this venture:\n\n{venture_summary}",
        tool=BRAIN_TOOL,
        max_tokens=2048,
    )

    # Task 2.2 — write Company Brain files
    context = {
        **inp["context_framework"],
        "company_id": company_id,
        "venture": venture.model_dump(),
        "token_budget_usd": venture.estimated_token_cost_ceiling_usd,
    }
    company_brain.write_context_framework(company_id, context)
    company_brain.write_skills(company_id, inp["skills_md"])

    ledger.record(
        company_id=company_id,
        event_type="company.brain.initialised",
        agent_type="ceo",
        payload={"context_keys": list(context.keys())},
    )
    print(f"[CEO-Agent] ✓ Company Brain written")

    # Task 2.3 — provision operator tasks
    tasks: list[OperatorTask] = []
    for raw in inp["operator_tasks"]:
        task = OperatorTask(
            company_id=company_id,
            role=raw["role"],
            description=raw["description"],
            risk_tier=raw.get("risk_tier", "low"),
        )
        tasks.append(task)
        ledger.record(
            company_id=company_id,
            event_type="task.created",
            agent_type="ceo",
            payload=task.model_dump(),
        )
        print(f"[CEO-Agent]   → Task [{task.role}]: {task.description[:60]}...")

    return company_id, tasks
