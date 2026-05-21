"""Entry point for the agent-verse corporate AI ecosystem.

Usage:
    python -m src.main
    python -m src.main --seed "AI-powered invoice reconciliation API"
    python -m src.main --model gpt-4o-mini
    python -m src.main --model gemini/gemini-2.5-flash
    python -m src.main --model ollama/llama3.2
    python -m src.main --venture '{"company_name":"pdf-ocr-api", ...}'
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Load .env if present
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


def _check_credentials(model: str) -> None:
    """Validate that the API key required by `model` is present."""
    from src.llm import provider_of, required_env_for

    env_var = required_env_for(model)
    if env_var is None:
        # e.g. Ollama — nothing to check; we just hope the daemon is reachable
        print(f"[startup] Provider: {provider_of(model)} (no API key required)")
        return

    if not os.environ.get(env_var):
        print(f"ERROR: ${env_var} is not set, but model '{model}' requires it.")
        print(f"       Provider: {provider_of(model)}")
        print(f"       Copy .env.example → .env and set the key, or export it:")
        print(f"         export {env_var}=...")
        sys.exit(1)

    print(f"[startup] Provider: {provider_of(model)} | Model: {model}")


def main():
    parser = argparse.ArgumentParser(description="Agent-Verse Corporate AI Ecosystem")
    parser.add_argument("--seed", type=str, default=None,
                        help="Optional domain hint for the Idea-Agent")
    parser.add_argument("--venture", type=str, default=None,
                        help="Skip Idea-Agent by providing a raw VenturePayload JSON string")
    parser.add_argument("--model", type=str, default=None,
                        help="Override AGENT_MODEL (e.g. gpt-4o-mini, gemini/gemini-2.5-flash, ollama/llama3.2)")
    parser.add_argument("--max-cycles", type=int, default=3,
                        help="Max monitor improvement cycles (default: 3)")
    args = parser.parse_args()

    # Apply model override before any agent code imports/reads it
    if args.model:
        os.environ["AGENT_MODEL"] = args.model
    model = os.environ.get("AGENT_MODEL", "claude-sonnet-4-6")

    _check_credentials(model)

    import src.graph as graph_module
    graph_module.MAX_MONITOR_CYCLES = args.max_cycles

    from src.graph import build_graph

    initial_state: dict = {
        "venture_payload": None,
        "seed_prompt": args.seed,
        "company_id": "",
        "operator_tasks": [],
        "cycle": 0,
        "monitor_report": None,
        "iteration_complete": False,
    }

    if args.venture:
        initial_state["venture_payload"] = json.loads(args.venture)

    print("=" * 60)
    print("  AGENT-VERSE  |  Autonomous Corporate AI Ecosystem")
    print("=" * 60)
    print()

    graph = build_graph()
    final_state = graph.invoke(initial_state)

    # ── Summary ──────────────────────────────────────────────────────────────
    print()
    print("=" * 60)
    print("  EXECUTION COMPLETE")
    print("=" * 60)
    company_id = final_state.get("company_id", "unknown")
    print(f"  Company:   {company_id}")
    print(f"  Cycles:    {final_state.get('cycle', 0)}")
    print(f"  Model:     {model}")

    tasks = final_state.get("operator_tasks", [])
    completed = sum(1 for t in tasks if t.get("status") == "completed")
    print(f"  Tasks:     {completed}/{len(tasks)} completed")

    report = final_state.get("monitor_report") or {}
    print(f"  Monitor:   {report.get('mitigation_type', 'n/a')}")

    brain_dir = Path(__file__).parent.parent / "companies" / company_id
    if brain_dir.exists():
        print(f"  Brain:     {brain_dir}")

    from src.ledger import DB_PATH
    print(f"  Ledger:    {DB_PATH}")
    print()

    return final_state


if __name__ == "__main__":
    main()
