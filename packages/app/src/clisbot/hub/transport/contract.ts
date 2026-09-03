export interface HubRequestInput {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}

export interface HubTransport {
  readonly signInKind: "password" | "system-browser";
  request(path: string, input?: HubRequestInput): Promise<Response>;
  signIn(
    input?: { email: string; password: string },
    context?: { invitationId?: string },
  ): Promise<void>;
  signOut(): Promise<void>;
}
