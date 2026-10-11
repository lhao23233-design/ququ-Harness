import type { Model, ModelPricing } from "../../shared/domain/model";

export interface CatalogRepository {
  listModels(providerId?: string): Promise<Model[]>;
  getPricing(modelId: string): Promise<ModelPricing | null>;
  refreshPricing(): Promise<void>;
}

export interface PricingSource {
  readonly id: string;
  fetchPricing(): Promise<ModelPricing[]>;
}
