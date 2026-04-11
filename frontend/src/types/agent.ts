/** Mirrors Go AgentContextDTO for AiChat / AiResolveCommand. */
export type AgentContext = {
  mode: "connections" | "docker" | "logs" | "settings";
  sessionId: string;
  profileId: string;
  dockerScope: "local" | "remote" | "";
  containerId: string;
};

export function emptyAgentContext(): AgentContext {
  return { mode: "settings", sessionId: "", profileId: "", dockerScope: "", containerId: "" };
}
