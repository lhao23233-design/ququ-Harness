import type { Workspace } from "../../shared/domain/workspace";

export interface WorkspaceAccess {
  list(): Promise<Workspace[]>;
  select(workspaceId: string): Promise<Workspace>;
  requestFileAccess(workspaceId: string, relativePath: string): Promise<Uint8Array>;
}

export interface PluginRuntime {
  start(pluginId: string, workspaceId: string): Promise<void>;
  stop(pluginId: string): Promise<void>;
}
