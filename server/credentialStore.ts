import { runWindowsCredentialAction } from "./windowsCredentialStore";
import { linuxSecretServiceCredentialStore } from "./linuxSecretServiceCredentialStore";

export type CredentialAction = "store" | "read" | "remove";

export interface CredentialResult {
  secret?: string | null;
}

export interface CredentialStore {
  run(action: CredentialAction, secret?: string, providerId?: string): Promise<CredentialResult>;
}

const windowsCredentialStore: CredentialStore = {
  run: runWindowsCredentialAction,
};

export function getCredentialStore(platform = process.platform): CredentialStore {
  if (platform === "win32") return windowsCredentialStore;
  if (platform === "linux") return linuxSecretServiceCredentialStore;
  return {
    run: async () => {
      throw new Error(`API 凭据存储尚未为 ${platform} 平台配置；不会将密钥保存为明文文件。`);
    },
  };
}
