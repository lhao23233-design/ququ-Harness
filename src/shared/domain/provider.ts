export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  protocol: "openai-compatible" | "anthropic";
  credentialRef?: string;
}
