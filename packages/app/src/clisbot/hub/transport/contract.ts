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
  subscribeSessionChange?(listener: () => void): () => void;
  /**
   * Reads the stored sign-in again and takes a new token; true when one is available. Called
   * before the account accepts "signed out", where a credential read can miss on a cold start.
   */
  recoverSignIn?(): Promise<boolean>;
  /** Present only where the client runs on the Hub origin. System-browser transports reach
   * Google through the Hub sign-in page instead. */
  signInWithGoogle?(context?: GoogleSignInContext): Promise<void>;
}
