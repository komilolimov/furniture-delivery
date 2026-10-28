import type { CrewReturnContext } from '@furniture-delivery/contracts';
/** A safe operational summary; old reports and attachments keep their original permissions. */
export function CrewReturnSummary({ context }: { context: CrewReturnContext }) {
  return (
    <section className="work-section" aria-label="Follow-up work">
      <h2>Follow-up work</h2>
      <p>{context.reason}</p>
      <p>
        <strong>Remaining work:</strong> {context.remainingWork}
      </p>
      <p>
        This visit has its own checklist. Previous results remain in the original report. Item
        quantities below are accumulated for the whole order.
      </p>
      {context.sourceTasks.length > 0 && (
        <details>
          <summary>Unfinished source tasks</summary>
          <ul>
            {context.sourceTasks.map((task) => (
              <li key={task.id}>
                {task.name} — {task.resultStatus.replaceAll('_', ' ')}
              </li>
            ))}
          </ul>
        </details>
      )}
      {context.scope.tasks.some((t) => t.addedReason) && (
        <ul>
          {context.scope.tasks
            .filter((t) => t.addedReason)
            .map((task) => (
              <li key={task.key}>
                Additional check: {task.name}. Reason: {task.addedReason}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
