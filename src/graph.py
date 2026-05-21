"""LangGraph StateGraph — connects all four agents into a directed cyclic graph.

Flow:
  idea_node → ceo_node → operator_node → monitor_node
                               ↑                |
                               └────────────────┘ (if not complete)
                                                → END (if complete or max cycles)
"""
from __future__ import annotations

from typing import Annotated, Any, Optional

from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict

from src.agents import ceo_agent, idea_agent, monitor_agent, operator_agent
from src.schemas import MonitorReport, OperatorTask, VenturePayload

MAX_MONITOR_CYCLES = 3


# ── Shared graph state ───────────────────────────────────────────────────────

class AgentState(TypedDict):
    # Set by Idea-Agent
    venture_payload: Optional[dict]
    seed_prompt: Optional[str]

    # Set by CEO-Agent
    company_id: str
    operator_tasks: list[dict]

    # Updated by Operator-Agents and Monitor-Agent
    cycle: int
    monitor_report: Optional[dict]
    iteration_complete: bool


# ── Node implementations ─────────────────────────────────────────────────────

def idea_node(state: AgentState) -> AgentState:
    if state.get("venture_payload"):
        print("[Idea-Agent] Skipped — venture payload pre-supplied.")
        return state
    payload = idea_agent.run(seed_prompt=state.get("seed_prompt"))
    return {**state, "venture_payload": payload.model_dump()}


def ceo_node(state: AgentState) -> AgentState:
    venture = VenturePayload(**state["venture_payload"])
    company_id, tasks = ceo_agent.run(venture)
    return {
        **state,
        "company_id": company_id,
        "operator_tasks": [t.model_dump() for t in tasks],
        "cycle": 0,
    }


def operator_node(state: AgentState) -> AgentState:
    """Run all three Operator-Agents sequentially (parallel dispatch is optional upgrade)."""
    updated_tasks = []
    for raw in state["operator_tasks"]:
        task = OperatorTask(**raw)
        # Reset failed/blocked tasks for a new cycle if monitor updated skills
        if state.get("cycle", 0) > 0 and task.status in ("failed", "blocked"):
            task.status = "pending"
            task.error = None
            task.result = None
        completed_task = operator_agent.run(task)
        updated_tasks.append(completed_task.model_dump())
    return {**state, "operator_tasks": updated_tasks}


def monitor_node(state: AgentState) -> AgentState:
    tasks = [OperatorTask(**t) for t in state["operator_tasks"]]
    cycle = state.get("cycle", 0) + 1
    report = monitor_agent.run(state["company_id"], tasks, cycle)
    return {
        **state,
        "cycle": cycle,
        "monitor_report": report.model_dump(),
        "iteration_complete": report.iteration_complete,
    }


# ── Routing logic ────────────────────────────────────────────────────────────

def should_continue(state: AgentState) -> str:
    if state.get("iteration_complete", False):
        return "end"
    if state.get("cycle", 0) >= MAX_MONITOR_CYCLES:
        print(f"\n[Graph] Max monitor cycles ({MAX_MONITOR_CYCLES}) reached — halting.")
        return "end"
    return "continue"


# ── Graph construction ───────────────────────────────────────────────────────

def build_graph():
    g = StateGraph(AgentState)

    g.add_node("idea", idea_node)
    g.add_node("ceo", ceo_node)
    g.add_node("operators", operator_node)
    g.add_node("monitor", monitor_node)

    g.add_edge(START, "idea")
    g.add_edge("idea", "ceo")
    g.add_edge("ceo", "operators")
    g.add_edge("operators", "monitor")
    g.add_conditional_edges(
        "monitor",
        should_continue,
        {"continue": "operators", "end": END},
    )

    return g.compile()
