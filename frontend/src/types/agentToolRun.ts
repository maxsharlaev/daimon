/** One approved / cancelled agent shell command row (from AI `tool` messages). */
export type AgentToolRun = {
  id: string;
  command: string;
  output: string;
  cancelled: boolean;
  error?: string;
  /** Snapshot of connection when the command was resolved (from server `contextLabel`). */
  contextLabel?: string;
  /** Cached model explanation merged into the tool message payload (no second LLM call). */
  explainText?: string;
  /** Optional UI-only: command still running (not persisted on tool rows yet). */
  inProgress?: boolean;
};
