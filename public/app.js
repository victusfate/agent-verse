/**
 * Client-Side Application Logic (public/app.js)
 * Implements real-time dashboard updates via WebSockets and HTTP API polling,
 * animates the active agent state-graph, renders the ledger terminal,
 * formats the company brain explorer, and handles Human-at-the-Edge controls.
 */

document.addEventListener("DOMContentLoaded", () => {
  // Select DOM Elements
  const metricsCompany = document.getElementById("metrics-company");
  const metricsIteration = document.getElementById("metrics-iteration");
  const metricsCost = document.getElementById("metrics-cost");
  const metricsBudget = document.getElementById("metrics-budget");
  
  const graphStateLabel = document.getElementById("graph-state-label");
  const terminalLogs = document.getElementById("terminal-logs");
  
  const inputCustomIdea = document.getElementById("input-custom-idea");
  const btnLaunchVenture = document.getElementById("btn-launch-venture");
  const btnTriggerFriction = document.getElementById("btn-trigger-friction");
  const btnTriggerPayment = document.getElementById("btn-trigger-payment");
  
  const inputBudget = document.getElementById("input-budget");
  const btnUpdateBudget = document.getElementById("btn-update-budget");
  
  const approvalQueueSection = document.getElementById("approval-queue-section");
  const queueContainer = document.getElementById("queue-container");
  
  const btnClearLogs = document.getElementById("btn-clear-logs");
  const btnRefreshLogs = document.getElementById("btn-refresh-logs");
  
  const codeBrainContext = document.getElementById("code-brain-context");
  const markdownBrainSkills = document.getElementById("markdown-brain-skills");
  
  const tabDiffHeader = document.getElementById("tab-diff-header");
  const codeDiffRemoved = document.getElementById("code-diff-removed");
  const codeDiffAdded = document.getElementById("code-diff-added");

  // Active Reasoning Selectors
  const llmActivePill = document.getElementById("llm-active-pill");
  const radioGemini = document.getElementById("radio-gemini");
  const radioOllama = document.getElementById("radio-ollama");
  const geminiStatusDot = document.getElementById("gemini-status-dot");
  const ollamaStatusDot = document.getElementById("ollama-status-dot");
  const ollamaSelectionRow = document.getElementById("ollama-selection-row");
  const selectOllamaModel = document.getElementById("select-ollama-model");
  const btnSaveLlmConfig = document.getElementById("btn-save-llm-config");

  // Playback & Time-Travel DOM Selectors
  const playbackStatusLabel = document.getElementById("playback-status-label");
  const playbackStepDisplay = document.getElementById("playback-step-display");
  const playbackTimeline = document.getElementById("playback-timeline");
  const btnPlaybackFirst = document.getElementById("btn-playback-first");
  const btnPlaybackPrev = document.getElementById("btn-playback-prev");
  const btnPlaybackPause = document.getElementById("btn-playback-pause");
  const btnPlaybackPlay = document.getElementById("btn-playback-play");
  const btnPlaybackFf = document.getElementById("btn-playback-ff");
  const btnPlaybackLatest = document.getElementById("btn-playback-latest");
  const btnPlaybackClearDb = document.getElementById("btn-playback-clear-db");

  // Track cached company identity to avoid redundant fetching
  let currentCompanyId = null;
  let activeAgentCached = null;

  // Time-Travel State Variables
  let isTimeTraveling = false;
  let simulationSnapshots = [];
  let currentTimeTravelStep = 0;
  let playbackInterval = null;

  // Tabs Handler
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");
  
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      tabButtons.forEach(b => b.classList.remove("active"));
      tabPanels.forEach(p => p.classList.remove("active"));
      
      btn.classList.add("active");
      const targetTab = document.getElementById(btn.dataset.tab);
      if (targetTab) targetTab.classList.add("active");
    });
  });

  // Clear UI Logs
  btnClearLogs.addEventListener("click", () => {
    terminalLogs.innerHTML = `<div class="terminal-line system-line">[SYSTEM] Display logs cleared. Web telemetry active.</div>`;
  });

  // Reload logs directly from ledger DB file
  btnRefreshLogs.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/ledger");
      const logs = await res.json();
      terminalLogs.innerHTML = "";
      logs.forEach(log => appendLogToTerminal(log));
      terminalLogs.scrollTop = terminalLogs.scrollHeight;
    } catch (err) {
      console.error("Failed to reload ledger files: ", err);
    }
  });

  // Establish WebSockets Telemetry Link
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}`;
  let ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    
    if (payload.type === "system_state") {
      if (!isTimeTraveling) {
        updateUIState(payload.data);
      }
    } else if (payload.type === "ledger_entry") {
      if (!isTimeTraveling) {
        appendLogToTerminal(payload.data);
      }
    } else if (payload.type === "simulation_snapshot") {
      syncTimelineData();
    }
  };

  ws.onclose = () => {
    console.warn("WebSocket closed. Attempting reconnect in 3s...");
    setTimeout(() => {
      ws = new WebSocket(wsUrl);
    }, 3000);
  };

  /**
   * Appends a single log entry into the ledger terminal
   */
  function appendLogToTerminal(log) {
    const timestampStr = new Date(log.timestamp).toLocaleTimeString();
    const cleanMsg = typeof log.message === 'string' ? log.message : JSON.stringify(log.message);
    
    const lineElement = document.createElement("div");
    lineElement.className = `terminal-line line-${log.level.toLowerCase()}`;
    
    // Construct rich text line
    lineElement.innerHTML = `
      <span class="line-timestamp">[${timestampStr}]</span>
      <span class="line-agent">&lt;${log.agent}&gt;</span>
      <span class="line-text">${cleanMsg}</span>
    `;

    // Append metadata JSON collapsible if it contains payloads
    if (log.metadata && Object.keys(log.metadata).length > 0) {
      const metaStr = JSON.stringify(log.metadata, null, 2);
      const detailsNode = document.createElement("details");
      detailsNode.style.marginTop = "4px";
      detailsNode.style.color = "var(--text-muted)";
      detailsNode.innerHTML = `
        <summary style="cursor:pointer; outline:none; font-size:10px;">View Transaction Telemetry Stack</summary>
        <pre style="margin-top:4px; padding:6px; background:rgba(0,0,0,0.5); border-radius:4px; font-size:9px; white-space:pre-wrap;">${metaStr}</pre>
      `;
      lineElement.appendChild(detailsNode);
    }

    terminalLogs.appendChild(lineElement);
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }

  /**
   * Main state orchestrator updating all components
   */
  function updateUIState(state) {
    // 1. Core Metrics Updates
    metricsCompany.textContent = state.activeCompanyId ? state.activeCompanyId : "Idle";
    metricsIteration.textContent = state.currentIteration - 1;
    metricsCost.textContent = `$${parseFloat(state.totalCost).toFixed(2)} USD`;
    metricsBudget.textContent = `$${parseFloat(state.budgetCeiling).toFixed(2)} USD`;
    
    // Update graph label
    if (state.activeAgent === "Idle") {
      graphStateLabel.textContent = "ENGINE IDLE";
      graphStateLabel.className = "live-status";
    } else {
      graphStateLabel.textContent = `${state.activeAgent.toUpperCase()} RUNNING`;
      graphStateLabel.className = "live-status running";
    }

    // 2. Animate Agent Nodes & Connective Paths
    updateStateGraphAnimation(state.activeAgent);

    // 3. Dynamic Company Brain loading
    if (state.activeCompanyId && state.activeCompanyId !== currentCompanyId) {
      currentCompanyId = state.activeCompanyId;
      fetchCompanyBrain(state.activeCompanyId);
    } else if (!state.activeCompanyId) {
      currentCompanyId = null;
      codeBrainContext.innerHTML = `// Company Brain not initialized. Launch a venture opportunity to view context framework.`;
      markdownBrainSkills.innerHTML = `<p>Company Brain not initialized. Launch a venture opportunity to view operating memory.</p>`;
    }

    // Periodically fetch brain files anyway during iterations to catch self-updates!
    if (state.activeCompanyId && Math.random() < 0.15) { 
      fetchCompanyBrain(state.activeCompanyId);
    }

    // 4. Human Approval Queue Updates
    updateApprovalQueue(state.humanApprovalQueue);

    // 5. Self-Healing Diff Tab Viewer
    if (state.hasPatchedCode) {
      tabDiffHeader.style.display = "block";
      codeDiffRemoved.textContent = state.originalCalculatorCode;
      codeDiffAdded.textContent = state.patchedCalculatorCode;
    } else {
      tabDiffHeader.style.display = "none";
    }

    // 6. Update reasoning provider active status pill
    if (llmActivePill) {
      llmActivePill.textContent = state.llmProvider || "Detecting...";
    }
  }

  /**
   * Animates active node paths and highlights the executing agent class
   */
  function updateStateGraphAnimation(activeAgent) {
    if (activeAgent === activeAgentCached) return;
    activeAgentCached = activeAgent;

    // Reset all nodes
    document.querySelectorAll(".graph-node").forEach(node => {
      node.classList.remove("active-node");
    });

    // Reset all SVG connection lines
    document.querySelectorAll(".graph-connections path").forEach(path => {
      path.classList.remove("active-path");
    });

    // Activate current node
    const activeNode = document.getElementById(`node-${activeAgent}`);
    if (activeNode) {
      activeNode.classList.add("active-node");
    }

    // Activate connective path animations depending on active step
    const ideaLine = document.getElementById("line-idea-ceo");
    const ceoLine = document.getElementById("line-ceo-operators");
    const monitorToOperatorsLine = document.getElementById("line-monitor-operators");
    const operatorsToMonitorLine = document.getElementById("line-operators-monitor");
    const humanLine = document.getElementById("line-operators-human");

    if (activeAgent === "Idea-Agent") {
      ideaLine.classList.add("active-path");
    } else if (activeAgent === "CEO-Agent") {
      ceoLine.classList.add("active-path");
    } else if (activeAgent === "Operator-Agents") {
      ceoLine.classList.add("active-path");
    } else if (activeAgent === "Monitor-Agent") {
      operatorsToMonitorLine.classList.add("active-path");
    } else if (activeAgent === "Human-Edge") {
      humanLine.classList.add("active-path");
    }
  }

  /**
   * Pulls context files context_framework.json & skills.md from backend
   */
  async function fetchCompanyBrain(companyId) {
    try {
      const res = await fetch(`/api/brain/${companyId}`);
      if (!res.ok) return;
      const data = await res.json();
      
      // Beautiful syntax coloring format for JSON
      codeBrainContext.textContent = JSON.stringify(data.context, null, 2);
      
      // Basic markdown conversion for UI rendering
      markdownBrainSkills.innerHTML = parseMarkdownHeuristics(data.skills);
    } catch (err) {
      console.error("Failed to load brain components: ", err);
    }
  }

  /**
   * Quick Markdown parser for clean UI rendering
   */
  function parseMarkdownHeuristics(md) {
    let html = md;
    
    // Titles
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    
    // Bold / List items
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
    
    // Wrap lists
    html = html.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');
    // Deduplicate lists wrapping
    html = html.replace(/<\/ul>\s*<ul>/g, '');

    return html;
  }

  /**
   * Render transaction details inside Human Approval Queue
   */
  function updateApprovalQueue(queue) {
    if (!queue || queue.length === 0) {
      approvalQueueSection.style.display = "none";
      queueContainer.innerHTML = "";
      return;
    }

    approvalQueueSection.style.display = "block";
    queueContainer.innerHTML = "";

    queue.forEach(item => {
      const itemElement = document.createElement("div");
      itemElement.className = "queue-item";
      itemElement.innerHTML = `
        <div class="queue-details">
          <span class="queue-title">Stripe Payment Gated Limit Breached</span>
          <span class="queue-meta">Recipient: <strong>${item.sensorEvent.payload.recipient}</strong></span>
          <span class="queue-meta">Transfer Amount: <strong style="color:var(--warning-glow); font-size:12px;">$${parseFloat(item.sensorEvent.payload.amount).toFixed(2)} USD</strong></span>
        </div>
        <div class="queue-actions">
          <button class="btn btn-sm btn-secondary" onclick="handleHumanAction('human-reject', '${item.id}')">Reject</button>
          <button class="btn btn-sm btn-warning" onclick="handleHumanAction('human-approve', '${item.id}')">Approve Link</button>
        </div>
      `;
      queueContainer.appendChild(itemElement);
    });
  }

  // Handle Global human decision clicks
  window.handleHumanAction = async (action, id) => {
    try {
      const res = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload: { id } })
      });
      const data = await res.json();
      console.log(`Action "${action}" processed: `, data.message);
    } catch (err) {
      console.error(`Human intervention click failed: `, err);
    }
  };

  /**
   * Buttons & Input Interaction Bindings
   */

  // 1. Submit custom venture schema
  btnLaunchVenture.addEventListener("click", async () => {
    const text = inputCustomIdea.value.trim();
    const payload = {};
    if (text) {
      payload.company_name = text;
      payload.core_value_proposition = `Automated high-margin service opportunity for ${text}.`;
      payload.target_audience = "E-Commerce Merchants & SMBs";
    }

    btnLaunchVenture.disabled = true;
    btnLaunchVenture.textContent = "Processing...";
    
    try {
      await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit-venture", payload })
      });
      inputCustomIdea.value = "";
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => {
        btnLaunchVenture.disabled = false;
        btnLaunchVenture.textContent = "Scrape & Launch";
      }, 1000);
    }
  });

  // 2. Force friction discount rate trigger
  btnTriggerFriction.addEventListener("click", async () => {
    btnTriggerFriction.disabled = true;
    try {
      await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inject-friction" })
      });
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => {
        btnTriggerFriction.disabled = false;
      }, 1000);
    }
  });

  // 3. Trigger Policy Gate Threshold Payment
  btnTriggerPayment.addEventListener("click", async () => {
    btnTriggerPayment.disabled = true;
    try {
      await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger-payment", payload: { amount: 750.00 } })
      });
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => {
        btnTriggerPayment.disabled = false;
      }, 1000);
    }
  });

  // 4. Update Budget ceiling override
  btnUpdateBudget.addEventListener("click", async () => {
    const budgetVal = parseFloat(inputBudget.value);
    if (isNaN(budgetVal) || budgetVal <= 0) return alert("Please specify a valid budget amount.");

    btnUpdateBudget.disabled = true;
    try {
      await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adjust-budget", payload: { budgetCeiling: budgetVal } })
      });
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => {
        btnUpdateBudget.disabled = false;
      }, 800);
    }
  });

  // Fetch Reasoning Engine configuration
  async function loadLlmConfig() {
    try {
      const res = await fetch("/api/llm-config");
      const config = await res.json();
      
      // Set radio states
      if (config.llmProvider === "gemini") {
        radioGemini.checked = true;
        ollamaSelectionRow.style.display = "none";
      } else {
        radioOllama.checked = true;
        ollamaSelectionRow.style.display = "flex";
      }

      // Status dots
      geminiStatusDot.className = `status-dot ${config.geminiAvailable ? 'online' : 'offline'}`;
      ollamaStatusDot.className = `status-dot ${config.ollamaOnline ? 'online' : 'offline'}`;

      // Populate Ollama models list
      selectOllamaModel.innerHTML = "";
      if (config.installedOllamaModels && config.installedOllamaModels.length > 0) {
        config.installedOllamaModels.forEach(model => {
          const opt = document.createElement("option");
          opt.value = model;
          opt.textContent = model;
          if (model === config.ollamaModel) {
            opt.selected = true;
          }
          selectOllamaModel.appendChild(opt);
        });
      } else {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No local models found";
        opt.disabled = true;
        selectOllamaModel.appendChild(opt);
      }
    } catch (err) {
      console.error("Failed to load LLM config:", err);
    }
  }

  // Radio Selection listeners
  radioGemini.addEventListener("change", () => {
    ollamaSelectionRow.style.display = "none";
  });
  radioOllama.addEventListener("change", () => {
    ollamaSelectionRow.style.display = "flex";
  });

  // Apply Reasoning Config click listener
  btnSaveLlmConfig.addEventListener("click", async () => {
    const provider = radioGemini.checked ? "gemini" : "ollama";
    const model = selectOllamaModel.value;

    btnSaveLlmConfig.disabled = true;
    btnSaveLlmConfig.textContent = "Applying Hot-Swap...";

    try {
      const res = await fetch("/api/llm-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model })
      });
      const updated = await res.json();
      console.log("LLM config updated:", updated);
      
      // Reload config and state
      await loadLlmConfig();
      const stateRes = await fetch("/api/state");
      const state = await stateRes.json();
      updateUIState(state);
      
      btnSaveLlmConfig.textContent = "⚡ Engine Swapped Successfully!";
      btnSaveLlmConfig.style.background = "linear-gradient(135deg, var(--success-glow), #059669)";
    } catch (err) {
      console.error("LLM config update failed:", err);
      btnSaveLlmConfig.textContent = "❌ Apply Failed";
      btnSaveLlmConfig.style.background = "linear-gradient(135deg, var(--danger-glow), #dc2626)";
    } finally {
      setTimeout(() => {
        btnSaveLlmConfig.disabled = false;
        btnSaveLlmConfig.textContent = "⚡ Hot-Swap Reasoning Model";
        btnSaveLlmConfig.style.background = "";
      }, 1800);
    }
  });

  // ==========================================
  // Deterministic Time-Travel & Playback Engine
  // ==========================================

  /**
   * Syncs the time-travel range and populates cached snapshots
   */
  async function syncTimelineData() {
    try {
      const res = await fetch("/api/history/steps");
      const steps = await res.json();
      
      if (!Array.isArray(steps) || steps.length === 0) {
        // Reset controls
        playbackTimeline.disabled = true;
        playbackTimeline.max = "0";
        playbackTimeline.value = "0";
        playbackStepDisplay.textContent = "Step 0 / 0";
        disablePlaybackControls(true);
        simulationSnapshots = [];
        return;
      }

      simulationSnapshots = steps;
      playbackTimeline.disabled = false;
      
      const maxStep = steps[steps.length - 1].stepIndex;
      playbackTimeline.max = maxStep.toString();
      playbackStepDisplay.textContent = `${isTimeTraveling ? 'Time-Travel Step' : 'Live Step'} ${currentTimeTravelStep || maxStep} / ${maxStep}`;

      // Enable/disable controls
      disablePlaybackControls(false);
      
      if (!isTimeTraveling) {
        playbackTimeline.value = maxStep.toString();
        currentTimeTravelStep = maxStep;
      }
    } catch (err) {
      console.error("[PlaybackEngine] Failed to sync timeline data:", err);
    }
  }

  function disablePlaybackControls(disabled) {
    btnPlaybackFirst.disabled = disabled;
    btnPlaybackPrev.disabled = disabled;
    btnPlaybackPause.disabled = disabled;
    btnPlaybackPlay.disabled = disabled;
    btnPlaybackFf.disabled = disabled;
    btnPlaybackLatest.disabled = !isTimeTraveling;
  }

  /**
   * Enters time travel mode at a specific step index
   */
  async function enterTimeTravelMode(stepIndex) {
    isTimeTraveling = true;
    currentTimeTravelStep = stepIndex;
    playbackTimeline.value = stepIndex.toString();
    
    // Update badge and controls
    playbackStatusLabel.textContent = "TIME TRAVELING";
    playbackStatusLabel.className = "live-status running";
    playbackStatusLabel.style.color = "var(--secondary-glow)";
    playbackStatusLabel.style.borderColor = "rgba(6, 182, 212, 0.4)";
    disablePlaybackControls(false);

    try {
      const res = await fetch(`/api/history/step/${stepIndex}`);
      if (!res.ok) return;
      const snapshot = await res.json();

      // Hydrate core metrics, agent animations, and self-healing diff screens
      updateUIState(snapshot.systemState);
      
      // Highlight the active agent at this historical step
      updateStateGraphAnimation(snapshot.systemState.activeAgent);

      // Force render context and skills for company Brain at that iteration
      if (snapshot.systemState.activeCompanyId) {
        fetchCompanyBrain(snapshot.systemState.activeCompanyId);
      }

      // Filter and render ledger logs up to this step's historical cutoff
      const ledgerRes = await fetch("/api/ledger");
      const logs = await ledgerRes.json();
      terminalLogs.innerHTML = "";
      
      const cutoffTime = new Date(snapshot.timestamp).getTime();
      logs.forEach(log => {
        if (new Date(log.timestamp).getTime() <= cutoffTime) {
          appendLogToTerminal(log);
        }
      });

      playbackStepDisplay.textContent = `Time-Travel Step ${stepIndex} / ${playbackTimeline.max}`;
    } catch (err) {
      console.error("[PlaybackEngine] Failed to load step snapshot:", err);
    }
  }

  /**
   * Exits time travel mode and restores live server metrics
   */
  async function exitTimeTravelMode() {
    isTimeTraveling = false;
    stopPlayback();
    
    playbackStatusLabel.textContent = "LIVE RUNNING";
    playbackStatusLabel.className = "live-status";
    playbackStatusLabel.style.color = "";
    playbackStatusLabel.style.borderColor = "";

    await syncTimelineData();

    // Re-fetch latest live state
    try {
      const res = await fetch("/api/state");
      const state = await res.json();
      updateUIState(state);
      
      // Refresh full logs terminal
      const ledgerRes = await fetch("/api/ledger");
      const logs = await ledgerRes.json();
      terminalLogs.innerHTML = "";
      logs.forEach(log => appendLogToTerminal(log));
    } catch (err) {
      console.error("[PlaybackEngine] Failed to restore live state:", err);
    }
  }

  /**
   * Playback Timer Controls
   */
  function startPlayback(speed) {
    stopPlayback();
    isTimeTraveling = true;
    
    playbackStatusLabel.textContent = speed < 500 ? "FAST FORWARD" : "PLAYING";
    playbackStatusLabel.style.color = "var(--success-glow)";
    playbackStatusLabel.style.borderColor = "rgba(16, 185, 129, 0.4)";

    playbackInterval = setInterval(() => {
      const currentIdx = simulationSnapshots.findIndex(s => s.stepIndex === currentTimeTravelStep);
      if (currentIdx !== -1 && currentIdx < simulationSnapshots.length - 1) {
        const nextStep = simulationSnapshots[currentIdx + 1].stepIndex;
        enterTimeTravelMode(nextStep);
      } else {
        stopPlayback();
        playbackStatusLabel.textContent = "SIM PAUSED";
        playbackStatusLabel.style.color = "var(--warning-glow)";
      }
    }, speed);
  }

  function stopPlayback() {
    if (playbackInterval) {
      clearInterval(playbackInterval);
      playbackInterval = null;
    }
  }

  // Interactive Playback Event Listeners
  btnPlaybackFirst.addEventListener("click", () => {
    if (simulationSnapshots.length > 0) {
      enterTimeTravelMode(simulationSnapshots[0].stepIndex);
    }
  });

  btnPlaybackPrev.addEventListener("click", () => {
    const currentIdx = simulationSnapshots.findIndex(s => s.stepIndex === currentTimeTravelStep);
    if (currentIdx > 0) {
      enterTimeTravelMode(simulationSnapshots[currentIdx - 1].stepIndex);
    }
  });

  btnPlaybackPause.addEventListener("click", () => {
    stopPlayback();
    playbackStatusLabel.textContent = "SIM PAUSED";
    playbackStatusLabel.style.color = "var(--warning-glow)";
    playbackStatusLabel.style.borderColor = "rgba(245, 158, 11, 0.4)";
  });

  btnPlaybackPlay.addEventListener("click", () => {
    startPlayback(1000); // 1x
  });

  btnPlaybackFf.addEventListener("click", () => {
    startPlayback(300); // FF
  });

  btnPlaybackLatest.addEventListener("click", () => {
    exitTimeTravelMode();
  });

  btnPlaybackClearDb.addEventListener("click", async () => {
    if (confirm("Are you sure you want to clear all simulation history logs?")) {
      btnPlaybackClearDb.disabled = true;
      try {
        await fetch("/api/history/clear", { method: "POST" });
        await exitTimeTravelMode();
        await syncTimelineData();
      } catch (err) {
        console.error(err);
      } finally {
        btnPlaybackClearDb.disabled = false;
      }
    }
  });

  playbackTimeline.addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    enterTimeTravelMode(val);
  });

  // Query state and LLM config immediately upon initial render
  fetch("/api/state")
    .then(res => res.json())
    .then(state => {
      updateUIState(state);
      syncTimelineData();
    })
    .catch(err => console.error("Initial metrics lookup failed:", err));

  loadLlmConfig();
});
