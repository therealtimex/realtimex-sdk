/**
 * Credentials Module — read-only access to user-managed credentials
 *
 * Credential values are encrypted at rest and decrypted only on get().
 * Values should NEVER be printed to stdout or included in agent responses.
 */

import { HttpClient } from "./http";

export interface CredentialInfo {
  name: string;
  type: "http_header" | "query_auth" | "basic_auth" | "env_var";
  metadata: Record<string, any> | null;
}

export interface CredentialPayload {
  name: string;
  type: string;
  payload: Record<string, string>;
}

export class CredentialsModule {
  private httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /** List available credentials (names and types, no values). */
  async list(): Promise<CredentialInfo[]> {
    const response = await this.httpClient.fetch("/sdk/credentials");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Failed to list credentials");
    }
    return data.credentials || [];
  }

  /** Get a credential's decrypted payload by name. */
  async get(name: string): Promise<CredentialPayload> {
    const response = await this.httpClient.fetch(
      `/sdk/credentials/${encodeURIComponent(name)}`
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || `Failed to get credential: ${name}`);
    }
    return data.credential;
  }
}
