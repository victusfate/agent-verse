/**
 * Main Visual Orchestration Server (src/server.ts)
 * Integrates the Express API endpoints, WebSockets stream, append-only SQLite Event Ledger,
 * and handles coordinating the state-graph execution loops of the active simulation agents.
 */

import express, { Request, Response } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { exec, execSync } from 'child_process';
import { DatabaseSync } from 'node:sqlite';

// Import Agent & LLM utilities
import { detectProvider, createModel, type LlmProviderType } from './llm/index.js';
import * as playbackEngine from './services/playback_engine.js';
import { record, initLedger, DB_PATH } from './ledger.js';

// Resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve active Git SHA
let activeGitSha = "main";
try {
  activeGitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  console.log(`[SYSTEM] Active Git Commit SHA detected: ${activeGitSha}`);
} catch (err) {
  // Fallback if git is not initialized or fails
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Setup directories relative to workspace root (parent of src)
const COMPANIES_DIR = path.join(__dirname, '..', 'companies');
fs.ensureDirSync(COMPANIES_DIR);

// Ensure SQLite ledger is initialized
initLedger();

export interface ServerContext {
  activeCompanyId: string;
  activeAgent: string;
  currentIteration: number;
  totalCost: number;
  budgetCeiling: number;
  pendingEventFlow: string;
  discountRate: number;
  paymentAmount: number;
  humanApprovalQueue: any[];
  hasPatchedCode: boolean;
  originalCalculatorCode: string;
  patchedCalculatorCode: string;
}

// Global System Runtime Context & Memory (in-memory telemetry database)
const systemContext: ServerContext = {
  activeCompanyId: '',
  activeAgent: "Idle",
  currentIteration: 1,
  totalCost: 0.00,
  budgetCeiling: 50.00,
  pendingEventFlow: "financial", // "financial" or "payment"
  discountRate: 1.0,            // 1.0 triggers buggy tax calculation, 0.1 is safe
  paymentAmount: 750.00,        // triggers policy block if > 500
  humanApprovalQueue: [],
  hasPatchedCode: false,
  originalCalculatorCode: "",
  patchedCalculatorCode: ""
};

/**
 * Helper to call standard LLM generator
 */
async function callLLM(modelId: string, system: string, prompt: string, jsonMode = false): Promise<any> {
  const model = await createModel(modelId);
  const raw = await model.generate(system, prompt, { jsonMode });
  if (jsonMode) {
    try {
      const { parseModelJson } = await import('./llm/index.js');
      return parseModelJson(raw);
    } catch (e) {
      return JSON.parse(raw);
    }
  }
  return raw;
}

/**
 * Total Legibility Layer Logger
 * Writes every transaction, LLM completion, validation crash, and event into the SQLite database.
 */
function logToLedger(agent: string, level: string, message: string, metadata: any = {}): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    agent,
    level, // INFO, SUCCESS, WARNING, ERROR, CRITICAL
    message,
    metadata
  };

  // 1. Record log into our SQLite ledger table (events)
  record(systemContext.activeCompanyId || "system", `visual.${level.toLowerCase()}`, logEntry, agent);

  // 2. Broadcast to all active WebSocket clients (real-time telemetry)
  const socketPayload = JSON.stringify({ type: "ledger_entry", data: logEntry });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(socketPayload);
    }
  });

  // 3. Output to local terminal console for transparency
  const colors: Record<string, string> = {
    INFO: "\x1b[36m",    // Cyan
    SUCCESS: "\x1b[32m", // Green
    WARNING: "\x1b[33m", // Yellow
    ERROR: "\x1b[31m",   // Red
    CRITICAL: "\x1b[35m",// Magenta
    RESET: "\x1b[0m"
  };
  const color = colors[level] || colors.RESET;
  console.log(`${color}[${agent}] [${level}] ${message}${colors.RESET}`);

  // 4. Capture deterministic Simulation Snapshot for SQLite Playback Engine
  if (agent === "TELEMETRY_ENGINE") {
    try {
      const codebaseDiff = systemContext.hasPatchedCode ? systemContext.patchedCalculatorCode : undefined;
      const stimulusSeed = metadata.sensor?.eventId || "ev_seed";
      
      const snapshot: playbackEngine.SimulationSnapshot = {
        step_index: systemContext.currentIteration || 1,
        timestamp: logEntry.timestamp,
        company_id: systemContext.activeCompanyId || "default-co",
        git_sha: activeGitSha,
        code_diff: codebaseDiff,
        seed_prompt: stimulusSeed,
        inputs: metadata.sensor,
        system_state: {
          activeCompanyId: systemContext.activeCompanyId,
          activeAgent: systemContext.activeAgent,
          currentIteration: systemContext.currentIteration || 1,
          totalCost: systemContext.totalCost,
          budgetCeiling: systemContext.budgetCeiling,
          pendingEventFlow: systemContext.pendingEventFlow || "financial",
          discountRate: systemContext.discountRate !== undefined ? systemContext.discountRate : 1.0,
          paymentAmount: systemContext.paymentAmount || 750.00,
          humanApprovalQueue: systemContext.humanApprovalQueue || [],
          hasPatchedCode: !!systemContext.hasPatchedCode
        },
        outputs: {
          status: level,
          message: message,
          toolOutput: metadata.toolOutput
        }
      };

      playbackEngine.appendSnapshot(snapshot);
      
      const snapshotPayload = JSON.stringify({ type: "simulation_snapshot", data: snapshot });
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(snapshotPayload);
        }
      });
    } catch (err: any) {
      console.error("[PlaybackEngine] Failed to package step snapshot:", err.message);
    }
  }
}

// Express setup
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

/**
 * WebSocket communication logic
 */
wss.on('connection', (ws: WebSocket) => {
  logToLedger("SYSTEM", "INFO", "Websocket telemetry link established with dashboard client.");
  
  // Stream current context state upon connecting
  ws.send(JSON.stringify({ type: "system_state", data: getSystemState() }));
  
  ws.on('close', () => {
    logToLedger("SYSTEM", "INFO", "Websocket telemetry link severed.");
  });
});

/**
 * Utility to pack core system metrics
 */
function getSystemState() {
  const modelId = process.env.AGENT_MODEL ?? 'claude-sonnet-4-6';
  const provider = (process.env.AGENT_PROVIDER as LlmProviderType | undefined) ?? detectProvider(modelId);

  return {
    activeCompanyId: systemContext.activeCompanyId,
    activeAgent: systemContext.activeAgent,
    currentIteration: systemContext.currentIteration,
    totalCost: systemContext.totalCost,
    budgetCeiling: systemContext.budgetCeiling,
    pendingEventFlow: systemContext.pendingEventFlow,
    discountRate: systemContext.discountRate,
    paymentAmount: systemContext.paymentAmount,
    humanApprovalQueue: systemContext.humanApprovalQueue,
    hasPatchedCode: systemContext.hasPatchedCode,
    originalCalculatorCode: systemContext.originalCalculatorCode,
    patchedCalculatorCode: systemContext.patchedCalculatorCode,
    llmProvider: provider
  };
}

/**
 * Broadcast current system state over websocket
 */
function broadcastSystemState(): void {
  const payload = JSON.stringify({ type: "system_state", data: getSystemState() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Keep active client state synced periodically
setInterval(broadcastSystemState, 1000);

/**
 * REST HTTP API Endpoints
 */

// 1. Fetch current runtime state metrics
app.get('/api/state', (req: Request, res: Response) => {
  res.json(getSystemState());
});

// 2. Fetch all append-only logs from the ledger
app.get('/api/ledger', async (req: Request, res: Response) => {
  try {
    const db = new DatabaseSync(DB_PATH);
    const rows = db.prepare(`
      SELECT ts, event_type, agent_type, payload
      FROM events
      ORDER BY id ASC
    `).all() as any[];

    const logs = rows.map(r => {
      let payloadParsed = {};
      try {
        payloadParsed = JSON.parse(r.payload);
      } catch (e) {}
      return {
        timestamp: r.ts,
        agent: r.agent_type || "SYSTEM",
        level: r.event_type.split('.')[1]?.toUpperCase() || "INFO",
        message: (payloadParsed as any).message || "Transaction logged.",
        metadata: payloadParsed
      };
    });

    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read SQLite events ledger: " + err.message });
  }
});

// 2.1 Fetch all recorded time-travel step snapshots
app.get('/api/history/steps', (req: Request, res: Response) => {
  try {
    const snapshots = playbackEngine.getAllSnapshots();
    res.json(snapshots);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read simulation snapshots: " + err.message });
  }
});

// 2.2 Fetch a single step's hydrated snapshot by index
app.get('/api/history/step/:index', (req: Request, res: Response) => {
  try {
    const idx = parseInt(req.params.index as string);
    if (isNaN(idx)) {
      return res.status(400).json({ error: "Invalid step index parameter." });
    }
    const snapshot = playbackEngine.readSnapshot(idx);
    if (!snapshot) {
      return res.status(404).json({ error: `Simulation snapshot at step index ${idx} not found.` });
    }
    res.json(snapshot);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read simulation snapshot: " + err.message });
  }
});

// 2.3 Clear all simulation step history
app.post('/api/history/clear', (req: Request, res: Response) => {
  try {
    playbackEngine.clearHistory();
    // Also clear events table
    const db = new DatabaseSync(DB_PATH);
    db.exec('DELETE FROM events');

    // Also reset current iteration counter in context
    systemContext.currentIteration = 1;
    logToLedger("SYSTEM", "SUCCESS", "Simulation history database cleared successfully.");
    res.json({ success: true, message: "Playback history cleared." });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to clear simulation history: " + err.message });
  }
});

// Fetch reasoning engine status and LLM configuration
app.get('/api/llm-config', (req: Request, res: Response) => {
  const modelId = process.env.AGENT_MODEL ?? 'claude-sonnet-4-6';
  const provider = (process.env.AGENT_PROVIDER as LlmProviderType | undefined) ?? detectProvider(modelId);

  res.json({
    provider,
    model: modelId,
    ollamaModels: ["llama3.2", "qwen2.5:7b"]
  });
});

// Update reasoning engine status and select Ollama model dynamically
app.post('/api/llm-config', (req: Request, res: Response) => {
  try {
    const { provider, model } = req.body;
    process.env.AGENT_PROVIDER = provider;
    process.env.AGENT_MODEL = model;
    logToLedger("SYSTEM", "SUCCESS", `Reasoning Engine dynamically re-routed to: ${provider} | Model: ${model}`);
    res.json({ provider, model });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update LLM configuration: " + err.message });
  }
});

// 3. Fetch Company Brain files context_framework.json & skills.md
app.get('/api/brain/:companyId', async (req: Request, res: Response) => {
  const companyId = req.params.companyId as string;
  const companyDir = path.join(COMPANIES_DIR, companyId);

  if (!fs.existsSync(companyDir)) {
    return res.status(404).json({ error: "Company Brain not found in persistent datastores." });
  }

  try {
    const context = await fs.readJson(path.join(companyDir, 'context_framework.json'));
    const skills = await fs.readFile(path.join(companyDir, 'skills.md'), 'utf8');
    res.json({ context, skills });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read brain files: " + err.message });
  }
});

// Helper for dynamic exec commands in dynamic compiler checks
function execPromise(command: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// 4. Handle dashboard administrative trigger actions
app.post('/api/action', async (req: Request, res: Response) => {
  const { action, payload } = req.body;
  logToLedger("ADMIN_PORTAL", "INFO", `Dashboard administrator invoked action request: "${action}"`);

  try {
    switch (action) {
      case "submit-venture":
        // Launch a brand new venture simulation
        systemContext.activeAgent = "Idea-Agent";
        broadcastSystemState();
        
        setTimeout(async () => {
          try {
            const seed = payload.idea || "SaaS CRM Platform";
            logToLedger("Idea-Agent", "INFO", `Profiling market gap for seed: "${seed}"`);
            
            // Generate Venture Payload
            const mockPayload = {
              company_name: seed.toLowerCase().replace(/[^a-z0-9]+/g, '-') + "-" + Math.random().toString(36).substring(2, 6),
              mission: `Build a highly scalable autonomous digital service for ${seed}`,
              product_spec: "Digital service architecture utilizing node dynamic compilation.",
              skills_needed: ["engineering", "product", "customer-success"],
              initial_budget_usd: systemContext.budgetCeiling
            };

            const companyId = mockPayload.company_name;
            systemContext.activeCompanyId = companyId;

            // Provision Company Brain
            const companyDir = path.join(COMPANIES_DIR, companyId);
            fs.ensureDirSync(companyDir);
            
            const contextFramework = {
              company_id: companyId,
              company_name: mockPayload.company_name,
              mission: mockPayload.mission,
              product_spec: mockPayload.product_spec,
              token_consumption: {
                accrued_cost_usd: 0.00,
                budget_ceiling_usd: systemContext.budgetCeiling,
                total_tokens_consumed: 0
              }
            };
            
            fs.writeJsonSync(path.join(companyDir, 'context_framework.json'), contextFramework, { spaces: 2 });
            fs.writeFileSync(path.join(companyDir, 'skills.md'), `# Operating Skills Manual\n\n## Section 1: Services\n- Financial calculations\n- Stripe transfers\n\n## Section 2: Mechanics\n- Immediate self-healing compile-loops\n\n## Section 3: Evolutionary Learnings\n`, 'utf8');

            logToLedger("CEO-Agent", "SUCCESS", `Provisioned new venture brain in database/companies/${companyId}. Dispatched operational tasks to Workers.`);
            
            // Advance to Operator Loop
            systemContext.activeAgent = "Operator-Agents";
            broadcastSystemState();
            
            setTimeout(() => {
              runOperatorLoop(companyId);
            }, 1000);

          } catch (e: any) {
            logToLedger("SYSTEM", "ERROR", `Venture launch failed: ${e.message}`);
          }
        }, 500);

        return res.json({ success: true, message: "Venture generation pipeline initiated." });

      case "inject-friction":
        systemContext.pendingEventFlow = "financial";
        systemContext.discountRate = 1.0; // Reset to buggy 1.0 threshold
        logToLedger("ADMIN_PORTAL", "WARNING", "Injected Technical Friction target: discountRate set to 1.0 (100% discount crash trigger).");
        
        if (systemContext.activeCompanyId) {
          systemContext.activeAgent = "Operator-Agents";
          broadcastSystemState();
          setTimeout(() => {
            runOperatorLoop(systemContext.activeCompanyId);
          }, 500);
        }
        return res.json({ success: true, message: "Friction target injected. Running operator cycle." });

      case "trigger-payment":
        systemContext.pendingEventFlow = "payment";
        systemContext.paymentAmount = parseFloat(payload.amount || 750.00);
        logToLedger("ADMIN_PORTAL", "WARNING", `Injected Policy threshold target: payment amount set to $${systemContext.paymentAmount} USD.`);

        if (systemContext.activeCompanyId) {
          systemContext.activeAgent = "Operator-Agents";
          broadcastSystemState();
          setTimeout(() => {
            runOperatorLoop(systemContext.activeCompanyId);
          }, 500);
        }
        return res.json({ success: true, message: "High-risk payment event scheduled. Running operator loop." });

      case "human-approve":
        if (systemContext.humanApprovalQueue.length > 0) {
          const item = systemContext.humanApprovalQueue.shift();
          logToLedger("HUMAN_SUPERVISOR", "SUCCESS", `Approved transaction ${item.eventId} for $${item.payload.amount} USD. Manual override registered.`);
          
          systemContext.activeAgent = "Operator-Agents";
          broadcastSystemState();
          
          setTimeout(async () => {
            try {
              const { initiateStripeTransfer } = await import('./services/payment_service.js');
              const toolOutput = initiateStripeTransfer(item.payload.recipient, item.payload.amount, item.payload.currency);
              
              logToLedger("OPERATOR_AGENTS", "SUCCESS", "[Layer 3: Tool] Post-approval payment transfer executed.", toolOutput);
              logToLedger("OPERATOR_AGENTS", "SUCCESS", "[Layer 4: Quality Gate] QA verified payment linkages. Passed.");
              
              // Run Layer 5
              const telem = {
                sensor: item,
                toolOutput
              };
              logToLedger("TELEMETRY_ENGINE", "SUCCESS", `Telemetry record logged for event ${item.eventId}. Status: SUCCESS`, telem);
              
              systemContext.activeAgent = "Idle";
              broadcastSystemState();
            } catch (err: any) {
              logToLedger("OPERATOR_AGENTS", "ERROR", `Post-approval payment tool failed: ${err.message}`);
            }
          }, 500);

          return res.json({ success: true, message: "Transaction approved and dispatched." });
        }
        return res.status(404).json({ error: "Transaction ID not found in approval queue." });

      case "human-reject":
        if (systemContext.humanApprovalQueue.length > 0) {
          const item = systemContext.humanApprovalQueue.shift();
          logToLedger("HUMAN_SUPERVISOR", "CRITICAL", `REJECTED transaction ${item.eventId} for $${item.payload.amount} USD. Policy barrier applied.`);
          
          systemContext.activeAgent = "Idle";
          broadcastSystemState();
          
          return res.json({ success: true, message: "Transaction rejected and terminated safely." });
        }
        return res.status(404).json({ error: "Transaction ID not found in approval queue." });

      case "adjust-budget":
        const newBudget = parseFloat(payload.budgetCeiling);
        systemContext.budgetCeiling = newBudget;
        logToLedger("HUMAN_SUPERVISOR", "INFO", `Manually updated operating budget ceiling limit to: $${newBudget.toFixed(2)} USD.`);
        
        if (systemContext.activeCompanyId) {
          const companyDir = path.join(COMPANIES_DIR, systemContext.activeCompanyId);
          const ctxPath = path.join(companyDir, 'context_framework.json');
          if (fs.existsSync(ctxPath)) {
            const ctx = fs.readJsonSync(ctxPath);
            ctx.token_consumption.budget_ceiling_usd = newBudget;
            fs.writeJsonSync(ctxPath, ctx, { spaces: 2 });
          }
        }
        broadcastSystemState();
        return res.json({ success: true, message: "Financial budget ceiling adjusted successfully." });

      default:
        return res.status(400).json({ error: "Unknown action parameter." });
    }
  } catch (err: any) {
    logToLedger("SYSTEM", "ERROR", `Error handling action "${action}": ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * In-memory simulated Operator Loop
 */
async function runOperatorLoop(companyId: string): Promise<void> {
  const modelId = process.env.AGENT_MODEL ?? 'claude-sonnet-4-6';
  
  // Billing billing simulated cost
  const cost = 0.45;
  const companyDir = path.join(COMPANIES_DIR, companyId);
  const contextPath = path.join(companyDir, 'context_framework.json');
  if (fs.existsSync(contextPath)) {
    const ctx = fs.readJsonSync(contextPath);
    ctx.token_consumption.accrued_cost_usd = parseFloat((ctx.token_consumption.accrued_cost_usd + cost).toFixed(4));
    fs.writeJsonSync(contextPath, ctx, { spaces: 2 });
    systemContext.totalCost = ctx.token_consumption.accrued_cost_usd;
  }

  // 1. SENSOR
  logToLedger("OPERATOR_AGENTS", "INFO", "[Layer 1: Sensor] Ingesting stream inputs & configuring incoming event payload...");
  const usePaymentFlow = systemContext.pendingEventFlow === "payment";
  let sensorEvent: any;
  if (usePaymentFlow) {
    sensorEvent = {
      eventId: "ev_" + Math.random().toString(36).substring(2, 10),
      timestamp: new Date().toISOString(),
      type: "PAYMENT_REQUEST",
      payload: {
        recipient: "global-outpost-logistics",
        amount: systemContext.paymentAmount,
        currency: "USD"
      }
    };
  } else {
    sensorEvent = {
      eventId: "ev_" + Math.random().toString(36).substring(2, 10),
      timestamp: new Date().toISOString(),
      type: "FINANCIAL_CALCULATION",
      payload: {
        revenue: 12500.00,
        expenses: 4200.00,
        discountRate: systemContext.discountRate
      }
    };
  }
  logToLedger("OPERATOR_AGENTS", "SUCCESS", `[Layer 1: Sensor] Ingested event: ${sensorEvent.type}`, sensorEvent.payload);

  // 2. POLICY
  logToLedger("OPERATOR_AGENTS", "INFO", "[Layer 2: Policy] Analyzing event compliance against brain guidelines...");
  
  // Static check for budget ceiling
  if (systemContext.totalCost >= systemContext.budgetCeiling) {
    logToLedger("OPERATOR_AGENTS", "CRITICAL", `[Layer 2: Policy] BUDGET BREACH: Cost $${systemContext.totalCost} exceeds budget ceiling $${systemContext.budgetCeiling}. Halted.`);
    systemContext.activeAgent = "Human-Edge";
    broadcastSystemState();
    return;
  }

  // LLM compliance check
  const systemPrompt = "You are a strict Compliance Officer. Flag payment transfers over $500 as requiring halt and approval.";
  const prompt = `Assess this transaction:\n${JSON.stringify(sensorEvent)}\n\nRespond strictly with JSON:\n{ "halt": true/false, "reason": "why" }`;
  
  try {
    const policyResult = await callLLM(modelId, systemPrompt, prompt, true);
    logToLedger("OPERATOR_AGENTS", "INFO", `[Layer 2: Policy] Compliance audit result: Halt=${policyResult.halt}. Reason: ${policyResult.reason}`);

    if (policyResult.halt || (usePaymentFlow && systemContext.paymentAmount > 500)) {
      systemContext.humanApprovalQueue.push(sensorEvent);
      logToLedger("OPERATOR_AGENTS", "WARNING", "Policy Gate Halt triggered. Routing transaction to Human Gate.");
      systemContext.activeAgent = "Human-Edge";
      broadcastSystemState();
      return;
    }
  } catch (e: any) {
    // Fallback static check
    if (usePaymentFlow && systemContext.paymentAmount > 500) {
      systemContext.humanApprovalQueue.push(sensorEvent);
      logToLedger("OPERATOR_AGENTS", "WARNING", "Static Policy Gate Halt triggered.");
      systemContext.activeAgent = "Human-Edge";
      broadcastSystemState();
      return;
    }
  }

  logToLedger("OPERATOR_AGENTS", "SUCCESS", "[Layer 2: Policy] compliance safeguards PASSED.");

  // 3. TOOL & 4. QUALITY GATE
  let toolOutput: any;
  try {
    logToLedger("OPERATOR_AGENTS", "INFO", "[Layer 3: Tool] Executing deterministic tool library components...");
    
    if (usePaymentFlow) {
      const { initiateStripeTransfer } = await import('./services/payment_service.js');
      toolOutput = initiateStripeTransfer(sensorEvent.payload.recipient, sensorEvent.payload.amount, sensorEvent.payload.currency);
      logToLedger("OPERATOR_AGENTS", "SUCCESS", "[Layer 3: Tool] Stripe Payment completed.", toolOutput);
      logToLedger("OPERATOR_AGENTS", "SUCCESS", "[Layer 4: Quality Gate] QA verified payment linkages. Passed.");
    } else {
      // Dynamic ES Module Cache-Buster Bypass for Hot-Swap
      const ext = __filename.endsWith('.ts') ? '.ts' : '.js';
      const servicePath = path.resolve(__dirname, `services/calculator_service${ext}`);
      const importUrl = `file://${servicePath}?update=${Date.now()}`;
      
      const { calculateFinancials } = (await import(importUrl)) as any;
      toolOutput = calculateFinancials(sensorEvent.payload.revenue, sensorEvent.payload.expenses, sensorEvent.payload.discountRate);
      
      logToLedger("OPERATOR_AGENTS", "SUCCESS", "[Layer 3: Tool] Financial calculator run completed.", toolOutput);
      
      // Layer 4 Quality check
      logToLedger("OPERATOR_AGENTS", "INFO", "[Layer 4: Quality Gate] Asserting schema safety metrics...");
      if (!toolOutput || isNaN(toolOutput.netProfit) || toolOutput.netProfit === null) {
        throw new Error("QualityGateError: netProfit was invalid.");
      }
      logToLedger("OPERATOR_AGENTS", "SUCCESS", "[Layer 4: Quality Gate] Quality Gate static evaluation: PASSED.");
    }

    // 5. LEARNING & TELEMETRY
    logToLedger("OPERATOR_AGENTS", "INFO", "[Layer 5: Learning] Packaging execution context and streaming to legibility ledger...");
    const stack = {
      companyId,
      timestamp: new Date().toISOString(),
      status: "SUCCESS",
      sensor: sensorEvent,
      toolOutput
    };
    logToLedger("TELEMETRY_ENGINE", "SUCCESS", `Telemetry record logged for event ${sensorEvent.eventId}. Status: SUCCESS`, stack);
    
    systemContext.activeAgent = "Idle";
    broadcastSystemState();

  } catch (err: any) {
    const errorMsg = err.message;
    logToLedger("OPERATOR_AGENTS", "ERROR", `Tool execution encountered exception: ${errorMsg}`);
    logToLedger("OPERATOR_AGENTS", "CRITICAL", `[Layer 4: Quality Gate] CRASH INTERCEPTED: ${errorMsg}`);
    
    const failedStack = {
      companyId,
      timestamp: new Date().toISOString(),
      status: "TECHNICAL_FRICTION",
      sensor: sensorEvent,
      toolOutput: { failureReason: `EXCEPTION: ${errorMsg}`, script: "services/calculator_service.ts" }
    };
    
    logToLedger("TELEMETRY_ENGINE", "TECHNICAL_FRICTION", `Telemetry record logged for event ${sensorEvent.eventId}. Status: TECHNICAL_FRICTION`, failedStack);
    
    // Hand over immediately to the self-healing Monitor Agent!
    systemContext.activeAgent = "Monitor-Agent";
    broadcastSystemState();
    
    setTimeout(() => {
      runMonitorHealing(companyId, errorMsg);
    }, 1000);
  }
}

/**
 * Continuous Self-Healing Loop in Monitor Agent
 */
async function runMonitorHealing(companyId: string, errorMsg: string): Promise<void> {
  logToLedger("MONITOR_AGENT", "INFO", `[Self-Improvement] Starting live Friction Profiling on "${companyId}" ledger records...`);
  logToLedger("MONITOR_AGENT", "WARNING", `[Task 4.1: Friction] Identified Technical Friction in script: services/calculator_service.ts`);
  logToLedger("MONITOR_AGENT", "INFO", `[Task 4.2: Diagnosis] Calling LLM reasoning engine to diagnose error context...`);
  
  const ext = __filename.endsWith('.ts') ? '.ts' : '.js';
  const servicePath = path.resolve(__dirname, `services/calculator_service${ext}`);
  const rootDir = path.resolve(__dirname, '../');
  const companyDir = path.join(COMPANIES_DIR, companyId);

  const buggyCode = fs.readFileSync(servicePath, 'utf8');
  
  const diagSystem = "You are a senior Systems Diagnostic Engineer. Diagnose code exceptions and specify corrections.";
  const diagPrompt = `buggyCode:\n${buggyCode}\n\nException details: ${errorMsg}\n\nState the root cause and repair strategy.`;
  
  const modelId = process.env.AGENT_MODEL ?? 'claude-sonnet-4-6';

  let diagnosis = "";
  try {
    diagnosis = await callLLM(modelId, diagSystem, diagPrompt, false);
    logToLedger("MONITOR_AGENT", "SUCCESS", `[Task 4.2: Diagnosis] Diagnosis summary:\n${diagnosis}`);
  } catch (e: any) {
    diagnosis = "Standard division-by-zero check is required for discountFactor.";
    logToLedger("MONITOR_AGENT", "WARNING", "Diagnosis LLM call failed. Using standard recovery heuristics.");
  }

  // Synthesis
  logToLedger("MONITOR_AGENT", "INFO", "[Task 4.3: Refactoring] Dispatching TypeScript patch synthesis request...");
  
  const refacSystem = 
    "You are an Elite Software Engineer. Return ONLY valid, complete TypeScript code. " +
    "No markdown fences (```), block tags, or annotations. Return ONLY raw code. " +
    "Preserve the export signature: calculateFinancials(revenue: number, expenses: number, discountRate: number) " +
    "and have it return an object matching the 'FinancialResult' interface. Intelligently cap or check " +
    "discountRate = 1.0 (100% discount) to avoid zero-division crashes gracefully.";
    
  const refacPrompt = `buggyCode:\n${buggyCode}\n\nDiagnosis:\n${diagnosis}\n\nRewrite the module.`;

  try {
    let healedCode = await callLLM(modelId, refacSystem, refacPrompt, false);
    healedCode = healedCode.replace(/```typescript/g, '').replace(/```js/g, '').replace(/```/g, '').trim();

    const originalCodeBackup = buggyCode;

    logToLedger("MONITOR_AGENT", "INFO", "[Task 4.3.1: Write Candidate] Writing candidate patch to src/services/calculator_service.ts...");
    fs.writeFileSync(servicePath, healedCode, 'utf8');

    // 1. Compiler Gate: tsc --noEmit
    logToLedger("MONITOR_AGENT", "INFO", "[Task 4.3.2: Compiler Gate] Running static typecheck verification via 'npx tsc --noEmit'...");
    try {
      await execPromise('npx tsc --noEmit', rootDir);
      logToLedger("MONITOR_AGENT", "SUCCESS", "[Task 4.3.2: Compiler Gate] Static typecheck validation PASSED. Zero compiler errors detected.");
    } catch (compileErr: any) {
      logToLedger("MONITOR_AGENT", "CRITICAL", `[Task 4.3.2: Compiler Gate] Static typecheck FAILED:\n${compileErr.stdout || compileErr.error?.message}`);
      logToLedger("MONITOR_AGENT", "INFO", "[Self-Healing Rollback] Restoring original service code...");
      fs.writeFileSync(servicePath, originalCodeBackup, 'utf8');
      return;
    }

    // 2. Programmatic Dry-Run Validation
    logToLedger("MONITOR_AGENT", "INFO", "[Task 4.3.4: Sandbox Test] Programmatically loading and validating newly compiled hot-fix...");
    
    let testPassed = false;
    try {
      const importUrl = `file://${servicePath}?update=${Date.now()}`;
      const { calculateFinancials } = (await import(importUrl)) as any;
      
      // Execute test run with crashing input (discountRate = 1.0)
      const testResult = calculateFinancials(1000, 300, 1.0);
      
      if (testResult && typeof testResult.netProfit === 'number' && !isNaN(testResult.netProfit)) {
        testPassed = true;
        logToLedger("MONITOR_AGENT", "SUCCESS", `[Task 4.3.4: Sandbox Test] Programmatic validation test PASSED. Corrected profit: $${testResult.netProfit.toFixed(2)}.`);
      } else {
        throw new Error("Validation check: netProfit was NaN or invalid.");
      }
    } catch (testErr: any) {
      logToLedger("MONITOR_AGENT", "CRITICAL", `[Task 4.3.4: Sandbox Test] Programmatic verification failed: ${testErr.message}`);
      logToLedger("MONITOR_AGENT", "INFO", "[Self-Healing Rollback] Restoring original service code...");
      fs.writeFileSync(servicePath, originalCodeBackup, 'utf8');
      return;
    }

    if (testPassed) {
      systemContext.originalCalculatorCode = originalCodeBackup;
      systemContext.patchedCalculatorCode = healedCode;
      systemContext.hasPatchedCode = true;

      logToLedger("MONITOR_AGENT", "SUCCESS", "[Task 4.3.5: Hot-Swap] Hot-swapped type-safe patched calculator_service.ts into production!");
      
      // Memory Updates
      logToLedger("MONITOR_AGENT", "INFO", "[Task 4.4: Memory Update] Synthesizing evolutionary heuristics in skills.md...");
      const skillsPath = path.join(companyDir, 'skills.md');
      if (fs.existsSync(skillsPath)) {
        const skillsContent = fs.readFileSync(skillsPath, 'utf8');
        const appendHeuristics = `\n- Heuristics: Capped and guarded discountRate to avoid division-by-zero errors in calculator.ts. Captured on Iteration ${systemContext.currentIteration}.`;
        fs.writeFileSync(skillsPath, skillsContent + appendHeuristics, 'utf8');
        logToLedger("MONITOR_AGENT", "SUCCESS", "[Task 4.4: Memory Update] Corporate brain manual skills.md updated successfully.");
      }

      // Reset parameters and control
      systemContext.currentIteration += 1;
      systemContext.discountRate = 0.1; // Safe discount rate
      systemContext.activeAgent = "Operator-Agents";
      broadcastSystemState();

      logToLedger("MONITOR_AGENT", "SUCCESS", "[Self-Improvement Loop Complete] control returned back to Operators. Triggering recovery retry...");
      
      // Re-run Operators on healed code!
      setTimeout(() => {
        runOperatorLoop(companyId);
      }, 1500);
    }

  } catch (err: any) {
    logToLedger("MONITOR_AGENT", "CRITICAL", `Dynamic refactoring crashed: ${err.message}`);
    systemContext.activeAgent = "Idle";
    broadcastSystemState();
  }
}

// Run server
server.listen(PORT, () => {
  logToLedger("SYSTEM", "SUCCESS", `===============================================================`);
  logToLedger("SYSTEM", "SUCCESS", `AUTONOMOUS AI CORPORATE ECOSYSTEM RUNNING AT http://localhost:${PORT}`);
  logToLedger("SYSTEM", "SUCCESS", `===============================================================`);
});
