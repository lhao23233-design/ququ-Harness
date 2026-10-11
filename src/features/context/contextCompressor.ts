export interface ContextCompressor {
  compress(input: string, targetRatio: number): Promise<string>;
}

export interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
}
