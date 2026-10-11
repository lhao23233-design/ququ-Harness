export interface Model {
  id: string;
  providerId: string;
  displayName: string;
  contextWindow?: number;
  supportsTools: boolean;
  supportsThinking: boolean;
}

export interface ModelPricing {
  modelId: string;
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
  currency: string;
  sourceUrl: string;
  checkedAt: string;
}
