"""Entry point for the agent-verse corporate AI ecosystem.

Usage:
    python -m src.main
    python -m src.main --seed "AI-powered invoice reconciliation API"
    python -m src.main --venture '{"company_name":"pdf-ocr-api", ...}'  # skip Idea-Agent
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


def _check_api_key():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY is not set.")
        print("  Copy .env.example → .env and add your key, or export the variable.")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Agent-Verse Corporate AI Ecosystem")
    parser.add_argument("--seed", type=str, default=None,
                        help="Optional domain hint for the Idea-Agent")
    parser.add_argument("--venture", type=str, default=None,
                        help="Skip Idea-Agent by providing a raw VenturePayload JSON string")
    parser.add_argument("--max-cycles", type=int, default=3,
                        help="Max monitor improvement cycles (default: 3)")
    args = parser.parse_args()

    _check_api_key()

    # Patch max cycles into graph module at runtime
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
