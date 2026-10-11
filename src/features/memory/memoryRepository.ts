import type { AgentMemory } from "../../shared/domain/workspace";

export interface MemoryRepository {
  list(scope: AgentMemory["scope"], ownerId: string): Promise<AgentMemory[]>;
  save(memory: AgentMemory): Promise<void>;
  remove(memoryId: string): Promise<void>;
}
