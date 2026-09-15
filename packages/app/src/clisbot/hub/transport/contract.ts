export interface HubRequestInput {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}

export interface GoogleSignInContext {
  invitationId?: string;
  /** Started from first-run setup: the Google account claims the pristine Hub as its operator. */
  claimInstance?: boolean;
  /** Same-origin path Google returns to; defaults to the current page. */
  returnPath?: string;
}

export interface HubTransport {
  readonly signInKind: "password" | "system-browser";
  request(path: string, input?: HubRequestInput): Promise<Response>;
  signIn(
    input?: { email: string; password: string },
    context?: { invitationId?: string },
  ): Promise<void>;
  signOut(): Promise<void>;
  /** Present only where the client runs on the Hub origin. System-browser transports reach
   * Google through the Hub sign-in page instead. */
  signInWithGoogle?(context?: GoogleSignInContext): Promise<void>;
}
