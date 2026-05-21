"""Phase 1 — Idea-Agent: market scan + standardized venture payload generation."""
from __future__ import annotations

import json
import os

import anthropic
from pydantic import ValidationError

from src.schemas import VenturePayload

MODEL = os.environ.get("AGENT_MODEL", "claude-sonnet-4-6")

VENTURE_TOOL = {
    "name": "submit_venture_payload",
    "description": (
        "Format and submit a validated micro-business venture concept "
        "as a structured enterprise payload."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "company_name": {
                "type": "string",
                "description": "Kebab-case identifier, e.g. 'pdf-to-podcast-api'",
            },
            "core_value_proposition": {"type": "string"},
            "target_audience": {"type": "string"},
            "initial_capability_requirements": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of required APIs or external capabilities",
            },
            "estimated_token_cost_ceiling_usd": {
                "type": "number",
                "description": "Max LLM spend budget in USD (default 50)",
            },
        },
        "required": [
            "company_name",
            "core_value_proposition",
            "target_audience",
            "initial_capability_requirements",
            "estimated_token_cost_ceiling_usd",
        ],
    },
}

SYSTEM_PROMPT = """You are an Idea-Agent in an autonomous corporate AI ecosystem.

Your mandate is to identify high-margin, low-overhead programmatic service opportunities
that can be fully automated via APIs and LLM capabilities.

Criteria for a good micro-business concept:
- Fully digital, no physical components
- Can be operated entirely by AI agents via API calls
- Clear recurring revenue model (subscriptions, per-use, or B2B SaaS)
- Addressable with < $50 of LLM costs to build the MVP
- Target audience that is willing to pay for automation

You MUST use the submit_venture_payload tool to output your idea. Do not describe it in prose."""


def run(seed_prompt: str | None = None) -> VenturePayload:
    """Generate a venture payload. Optionally seed with a domain hint."""
    client = anthropic.Anthropic()

    user_message = seed_prompt or (
        "Scan the current API ecosystem and identify one high-value micro-business "
        "opportunity that AI agents can execute autonomously. Focus on B2B tooling, "
        "developer infrastructure, or AI-augmented workflows."
    )

    print("[Idea-Agent] Generating venture concept...")
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        tools=[VENTURE_TOOL],
        tool_choice={"type": "any"},
        messages=[{"role": "user", "content": user_message}],
    )

    for block in response.content:
        if block.type == "tool_use" and block.name == "submit_venture_payload":
            try:
                payload = VenturePayload(**block.input)
                print(f"[Idea-Agent] ✓ Venture identified: {payload.company_name}")
                return payload
            except ValidationError as e:
                raise RuntimeError(f"Idea-Agent produced invalid schema: {e}") from e

    raise RuntimeError("Idea-Agent did not call submit_venture_payload")
