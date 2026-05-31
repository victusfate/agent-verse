const TOOL_OUTPUT = JSON.stringify({
  deliverable: 'Simulated deliverable: task complete with full validation and documentation.',
  artifacts: ['simulated/output.md'],
  confidence: 0.85,
  next_actions: ['review output', 'proceed to next task'],
});

const POLICY_OUTPUT = JSON.stringify({
  allowed: true,
  risk_tier: 'low',
  reason: 'Simulated task is read-only and generative.',
  escalate_to_human: false,
});

const SUPERVISOR_OUTPUT = JSON.stringify({
  action: 'pass',
  reason: 'Risk is acceptable in simulation.',
  estimated_cost_usd: 0.01,
});

const MONITOR_OUTPUT = JSON.stringify({
  company_id: 'sim-co',
  cycle: 1,
  friction_points: [],
  diagnosis: 'No friction detected in simulation.',
  mitigation_type: 'none',
  skills_update: null,
  iteration_complete: true,
});

const IDEA_OUTPUT = JSON.stringify({
  company_name: 'sim-venture',
  core_value_proposition: 'Simulated venture for testing purposes.',
  target_audience: 'Developers',
  initial_capability_requirements: ['api', 'dashboard'],
  estimated_token_cost_ceiling_usd: 10,
});

const CEO_OUTPUT = JSON.stringify({
  context_framework: {
    mission: 'Simulate a venture end-to-end.',
    constraints: ['no real API calls'],
    token_budget_usd: 10,
    tokens_consumed_usd: 0,
    capabilities: ['simulation'],
  },
  skills_md: '# Simulated Skills\n\nAll tasks run in simulation mode.\n',
  operator_tasks: [
    { role: 'product', description: 'Define simulated product requirements', risk_tier: 'low' },
    { role: 'engineering', description: 'Build simulated engineering artifacts', risk_tier: 'low' },
    { role: 'customer-success', description: 'Draft simulated onboarding flow', risk_tier: 'low' },
  ],
});

export const FALLBACK = TOOL_OUTPUT;

export const FIXTURES: Record<string, string> = {
  'product:tool': TOOL_OUTPUT,
  'engineering:tool': TOOL_OUTPUT,
  'customer-success:tool': TOOL_OUTPUT,
  'product:policy': POLICY_OUTPUT,
  'engineering:policy': POLICY_OUTPUT,
  'customer-success:policy': POLICY_OUTPUT,
  'supervisor:policy': SUPERVISOR_OUTPUT,
  'monitor:diagnose': MONITOR_OUTPUT,
  'idea:generate': IDEA_OUTPUT,
  'ceo:init': CEO_OUTPUT,
};
