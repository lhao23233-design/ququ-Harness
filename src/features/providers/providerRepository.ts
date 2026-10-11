import type { Provider } from "../../shared/domain/provider";

export interface ProviderRepository {
  list(): Promise<Provider[]>;
  save(provider: Provider): Promise<void>;
  remove(providerId: string): Promise<void>;
}

export interface CredentialStore {
  store(providerId: string, secret: string): Promise<string>;
  read(reference: string): Promise<string | null>;
  remove(reference: string): Promise<void>;
}
