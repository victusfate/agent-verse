/**
 * State graph — wires all four agents into the full corporate AI loop.
 *
 *   Idea-Agent → CEO-Agent → [Operator × 3] ←─────────────────┐
 *                                    ↓                          │
 *                              Monitor-Agent → iteration_complete? → exit
 *
 * No LangGraph dependency — plain async with a while loop for the monitor cycle.
 */
import type { VenturePayload, OperatorTask, MonitorReport } from './schemas.js';
import * as ideaAgent from './agents/idea.js';
import * as ceoAgent from './agents/ceo.js';
import * as operatorAgent from './agents/operator.js';
import * as monitorAgent from './agents/monitor.js';

export let MAX_MONITOR_CYCLES = 3;

export interface AgentState {
  venturePayload: VenturePayload | null;
  seedPrompt: string | null;
  companyId: string;
  operatorTasks: OperatorTask[];
  cycle: number;
  monitorReport: MonitorReport | null;
  iterationComplete: boolean;
}

export async function runGraph(initial: Partial<AgentState> = {}): Promise<AgentState> {
  let state: AgentState = {
    venturePayload: null,
    seedPrompt: null,
    companyId: '',
    operatorTasks: [],
    cycle: 0,
    monitorReport: null,
    iterationComplete: false,
    ...initial,
  };

  // ── Node: Idea-Agent ──────────────────────────────────────────────────────
  if (!state.venturePayload) {
    state.venturePayload = await ideaAgent.run(state.seedPrompt ?? undefined);
  } else {
    console.log('[Idea-Agent] Skipped — venture payload pre-supplied.');
  }

  // ── Node: CEO-Agent ───────────────────────────────────────────────────────
  const [companyId, tasks] = await ceoAgent.run(state.venturePayload);
  state = { ...state, companyId, operatorTasks: tasks };

  // ── Loop: Operators → Monitor ─────────────────────────────────────────────
  while (!state.iterationComplete && state.cycle < MAX_MONITOR_CYCLES) {
    // Run all three operator agents in parallel
    const updatedTasks = await Promise.all(
      state.operatorTasks.map(task => operatorAgent.run(task)),
    );
    state.operatorTasks = updatedTasks;

    // Monitor — may update skills.md and decide iteration_complete
    state.cycle += 1;
    const report = await monitorAgent.run(state.companyId, state.operatorTasks, state.cycle);
    state.monitorReport = report;
    state.iterationComplete = report.iteration_complete;
  }

  return state;
}
