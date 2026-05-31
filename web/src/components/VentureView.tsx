interface Task {
  task_id: string;
  role: string;
  status: string;
  description: string;
}

interface Props {
  companyId: string;
  mission: string;
  cycle: number;
  tasks: Task[];
  skills: string;
}

export function VentureView({ companyId, mission, cycle, tasks, skills }: Props) {
  return (
    <section data-testid="venture-view">
      <h2 data-testid="company-id">{companyId}</h2>
      <p data-testid="mission">{mission}</p>
      <p data-testid="cycle">Cycle: {cycle}</p>
      <ul data-testid="task-list">
        {tasks.map(t => (
          <li key={t.task_id} data-testid="task-card" data-status={t.status}>
            <span data-testid="task-role">{t.role}</span>
            {': '}
            <span data-testid="task-status">{t.status}</span>
          </li>
        ))}
      </ul>
      <details data-testid="skills-section">
        <summary>skills.md</summary>
        <pre data-testid="skills-content">{skills}</pre>
      </details>
    </section>
  );
}
