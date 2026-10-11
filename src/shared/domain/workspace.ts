export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
}

export interface AgentMemory {
  id: string;
  scope: "project" | "model";
  ownerId: string;
  content: string;
  updatedAt: string;
}
