import { useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import {
  createContext,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFetchQuery } from "@/data/query";
import { HubApiClient } from "./api-client";
import { getHubConfiguration, type HubConfiguration } from "./config";
import {
  HubAccountStateSchema,
  HubRegistrationLinkSchema,
  type HubAccountState,
  type HubRegistrationLink,
  type HubSignedInState,
} from "./contracts";
import { createHubTransport } from "./transport/create";
import type { HubTransport } from "./transport/contract";
import { useHubProfiles, updateHubProfile } from "@/device-access/hub-profiles";
import { HubAccountRequestError, needsOwnerSetupRecovery } from "@/device-access/hub-account-error";
import { PairedHubTransport } from "@/device-access/hub-transport";
import {
  readHubDeviceCapabilities,
  type HubDeviceCapabilities,
} from "@/device-access/hub-capabilities";

interface HubAccountContextValue {
  googleSignInLabel?: string;
  connection?: HubDeviceCapabilities | null;
  enabled: boolean;
  /** Stable scope for existing caches and managed relationships; may be hub://<id>. */
  origin: string | null;
  /** HTTP connection route for enrollment links; null for a relay-only Hub. */
  connectionOrigin?: string | null;
  signInKind: "password" | "system-browser" | null;
  state: HubAccountState | null;
  signedIn: HubSignedInState | null;
  loading: boolean;
  error: string | null;
  signIn(input?: { email: string; password: string }): Promise<void>;
  signUp(input: {
    name: string;
    email: string;
    password: string;
    invitationId?: string;
  }): Promise<void>;
  /** Emails a sign-up link to an allowlisted company address (email-first self-registration). */
  startRegistration(email: string): Promise<HubRegistrationStart>;
  /** The registration link this page was opened with, held after it is removed from the URL. */
  registrationToken: string | null;
  inspectRegistration(token: string): Promise<HubRegistrationLink>;
  /** Creates, admits, and signs in the account; the account state refreshes on success. */
  completeRegistration(input: {
    token: string;
    name: string;
    password: string;
  }): Promise<HubRegistrationLink>;
  dismissRegistration(): void;
  /** Better Auth `update-user`; Hub validates the name and the image URL's host. */
  updateProfile(input: { name?: string; image?: string | null }): Promise<void>;
  /** Better Auth `organization/update`; Hub allows only owners to change the display name. */
  renameOrganization(name: string): Promise<void>;
  /** Undefined when this client reaches Google through the Hub sign-in page instead. */
  signInWithGoogle:
    | ((options?: { claimInstance?: boolean; returnPath?: string }) => Promise<void>)
    | undefined;
  claimInstance(input: { email: string; password: string }): Promise<void>;
  completeAppSetup(): Promise<void>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
  acceptInvitation(invitationId: string): Promise<void>;
  signOut(): Promise<void>;
  selectOrganization(organizationId: string): Promise<void>;
  createOrganization(name: string): Promise<void>;
  inviteMember(input: {
    email: string;
    role: "admin" | "member";
    teamId?: string;
    teamIds?: string[];
  }): Promise<void>;
  cancelInvitation(invitationId: string): Promise<void>;
  changeMemberRole(input: { memberId: string; role: "owner" | "admin" | "member" }): Promise<void>;
  removeMember(memberId: string): Promise<void>;
  refresh(): Promise<void>;
  api(): HubApiClient;
}

const disabledValue: HubAccountContextValue = {
  enabled: false,
  origin: null,
  signInKind: null,
  state: null,
  signedIn: null,
  loading: false,
  error: null,
  signIn: () => Promise.reject(new Error("Hub support is not included in this build.")),
  signUp: () => Promise.reject(new Error("Hub support is not included in this build.")),
  startRegistration: () => Promise.reject(new Error("Hub support is not included in this build.")),
  registrationToken: null,
  inspectRegistration: () =>
    Promise.reject(new Error("Hub support is not included in this build.")),
  completeRegistration: () =>
    Promise.reject(new Error("Hub support is not included in this build.")),
  dismissRegistration: () => undefined,
  updateProfile: () => Promise.reject(new Error("Hub support is not included in this build.")),
  renameOrganization: () => Promise.reject(new Error("Hub support is not included in this build.")),
  signInWithGoogle: undefined,
  claimInstance: () => Promise.reject(new Error("Hub support is not included in this build.")),
  completeAppSetup: () => Promise.reject(new Error("Hub support is not included in this build.")),
  changePassword: () => Promise.reject(new Error("Hub support is not included in this build.")),
  acceptInvitation: () => Promise.reject(new Error("Hub support is not included in this build.")),
  signOut: () => Promise.resolve(),
  selectOrganization: () => Promise.reject(new Error("Hub support is not included in this build.")),
  createOrganization: () => Promise.reject(new Error("Hub support is not included in this build.")),
  inviteMember: () => Promise.reject(new Error("Hub support is not included in this build.")),
  cancelInvitation: () => Promise.reject(new Error("Hub support is not included in this build.")),
  changeMemberRole: () => Promise.reject(new Error("Hub support is not included in this build.")),
  removeMember: () => Promise.reject(new Error("Hub support is not included in this build.")),
  refresh: () => Promise.resolve(),
  api: () => {
    throw new Error("Hub support is not included in this build.");
  },
};

const HubAccountContext = createContext<HubAccountContextValue>(disabledValue);
const unconfiguredHub = { origin: "hub://unconfigured" };
const disabledTransport: HubTransport = {
  signInKind: "password",
  request: async () => {
    throw new Error("Pair a Hub first.");
  },
  signIn: disabledValue.signIn,
  signOut: disabledValue.signOut,
};

export function HubAccountProvider({ children }: { children: ReactNode }) {
  const registry = useHubProfiles();
  const configuration = useMemo(() => {
    const profile = registry.profiles.find((value) => value.hubId === registry.activeId);
    // The logical origin keeps caches and managed relationships stable when routes change.
    return profile
      ? { origin: `hub://${profile.hubId}`, deviceProfile: profile }
      : getHubConfiguration();
  }, [registry]);
  const scope = configuration?.origin ?? unconfiguredHub.origin;
  const selection = useRef({ scope, generation: 0 });
  if (selection.current.scope !== scope)
    selection.current = { scope, generation: selection.current.generation + 1 };
  const generation = selection.current.generation;
  const [published, setPublished] = useState<{
    generation: number;
    value: HubAccountContextValue;
  } | null>(null);
  const publish = useCallback(
    (value: HubAccountContextValue) => {
      if (selection.current.generation !== generation || value.origin !== scope) return;
      setPublished({ generation, value });
    },
    [generation, scope],
  );
  // Account state is isolated by a keyed controller, while the navigation tree
  // remains mounted when saved profiles hydrate or a user changes Hub.
  const value = useMemo(() => {
    if (configuration === null) return disabledValue;
    if (published?.generation === generation) return published.value;
    return {
      ...disabledValue,
      enabled: true,
      loading: true,
      origin: scope,
      connectionOrigin: configuration.deviceProfile
        ? (configuration.deviceProfile.origin ?? null)
        : configuration.origin,
    };
  }, [configuration, generation, published, scope]);
  return (
    <>
      <HubAccountController
        key={`${generation}:${scope}`}
        configuration={configuration ?? unconfiguredHub}
        enabled={configuration !== null}
        publish={publish}
      />
      <HubAccountContext.Provider value={value}>{children}</HubAccountContext.Provider>
    </>
  );
}

const HubAccountController = memo(EnabledHubAccountController);

function EnabledHubAccountController({
  configuration,
  enabled,
  publish,
}: {
  configuration: HubConfiguration;
  enabled: boolean;
  publish(value: HubAccountContextValue): void;
}) {
  const transport = useMemo<HubTransport>(() => {
    if (!enabled) return disabledTransport;
    if (configuration.deviceProfile) return new PairedHubTransport(configuration.deviceProfile);
    return createHubTransport(configuration);
  }, [configuration, enabled]);
  useEffect(
    () => () => {
      if (transport instanceof PairedHubTransport) transport.close();
    },
    [transport],
  );
  const router = useRouter();
  const queryClient = useQueryClient();
  const currentUrl = Linking.useURL();
  const currentUrlRef = useRef(currentUrl);
  currentUrlRef.current = currentUrl;
  const [consumedInvitation, setConsumedInvitation] = useState<{
    url: string | null;
    id: string;
  } | null>(null);
  const invitationId = useMemo(() => {
    const id = invitationIdFromUrl(currentUrl);
    return consumedInvitation?.url === currentUrl && consumedInvitation.id === id ? null : id;
  }, [consumedInvitation, currentUrl]);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const account = useFetchQuery({
    queryKey: ["clisbot", "hub", configuration.origin, "account", invitationId],
    queryFn: () => readAccountState(transport, invitationId),
    enabled,
    dataShape: "value",
    retry: false,
    staleTimeMs: 15_000,
  });
  const connection = useFetchQuery({
    queryKey: ["clisbot", "hub", configuration.origin, "device-capabilities"],
    queryFn: () => readHubDeviceCapabilities(transport),
    enabled: Boolean(configuration.deviceProfile),
    dataShape: "value",
    retry: false,
    staleTimeMs: 15_000,
  });
  const refresh = useCallback(async () => {
    await Promise.all([
      account.refetch(),
      ...(configuration.deviceProfile ? [connection.refetch()] : []),
    ]);
  }, [account, configuration.deviceProfile, connection]);
  const run = useCallback(
    async (operation: () => Promise<void>) => {
      setMutationError(null);
      try {
        await operation();
        await refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Hub request failed.";
        setMutationError(message);
        throw error;
      }
    },
    [refresh],
  );
  const signIn = useCallback(
    (input?: { email: string; password: string }) =>
      run(() => transport.signIn(input, invitationId === null ? undefined : { invitationId })),
    [invitationId, run, transport],
  );
  const signUp = useCallback(
    (input: { name: string; email: string; password: string; invitationId?: string }) =>
      run(() =>
        accountCommand(transport, "/api/auth/sign-up/email", {
          name: input.name,
          email: input.email,
          password: input.password,
          ...(input.invitationId === undefined ? {} : { invitation: input.invitationId }),
        }),
      ),
    [run, transport],
  );
  const startRegistration = useCallback(
    (email: string) => startRegistrationRequest(transport, email),
    [transport],
  );
  const { registrationToken, dismissRegistration } = useRegistrationLink(currentUrl);
  const inspectRegistration = useCallback(
    (token: string) => registrationLinkRequest(transport, "inspect", { token }),
    [transport],
  );
  const completeRegistration = useCallback(
    async (input: { token: string; name: string; password: string }) => {
      const link = await registrationLinkRequest(transport, "complete", input);
      if (link.status === "registered") {
        dismissRegistration();
        await account.refetch();
      }
      return link;
    },
    [account, dismissRegistration, transport],
  );
  const recoverOwnerSetup = useCallback(
    async (error: unknown) => {
      if (!needsOwnerSetupRecovery(error)) return;
      if (transport instanceof PairedHubTransport) {
        const identity = await transport.identity();
        const metadata = await identity.json();
        if (identity.ok && metadata.hubId === configuration.deviceProfile?.hubId) {
          await updateHubProfile(metadata.hubId, {
            entry: metadata.entry,
            setupStatus: metadata.setupStatus,
          });
        }
      }
      await refresh();
    },
    [transport, configuration.deviceProfile, refresh],
  );
  const signInWithGoogle = useMemo(() => {
    const start = transport.signInWithGoogle?.bind(transport);
    if (start === undefined) return undefined;
    return (options?: { claimInstance?: boolean; returnPath?: string }) =>
      run(async () => {
        try {
          await start({
            ...(invitationId === null ? {} : { invitationId }),
            ...(options?.claimInstance === true ? { claimInstance: true } : {}),
            ...(options?.returnPath === undefined ? {} : { returnPath: options.returnPath }),
          });
        } catch (error) {
          if (options?.claimInstance) await recoverOwnerSetup(error);
          throw error;
        }
      });
  }, [invitationId, run, transport, recoverOwnerSetup]);
  const claimInstance = useCallback(
    (input: { email: string; password: string }) =>
      run(async () => {
        try {
          const response = await accountCommand<{
            state: "claimed" | "unavailable";
          }>(transport, "/api/auth/clisbot/claim-instance", input);
          if (response.state === "unavailable")
            throw new HubAccountRequestError("setup_unavailable", 409);
        } catch (error) {
          await recoverOwnerSetup(error);
          throw error;
        }
      }),
    [run, transport, recoverOwnerSetup],
  );

  const changePassword = useCallback(
    (input: { currentPassword: string; newPassword: string }) =>
      run(() => accountCommand(transport, "/api/auth/change-password", input)),
    [run, transport],
  );
  const completeAppSetup = useCallback(
    () => run(() => accountCommand(transport, "/api/auth/clisbot/complete-app-setup", {})),
    [run, transport],
  );
  const acceptInvitation = useCallback(
    (pendingInvitationId: string) =>
      run(async () => {
        await accountCommand(transport, "/api/auth/clisbot/accept-invitation", {
          invitationId: pendingInvitationId,
        });
        if (currentUrlRef.current !== currentUrl) return;
        // The no-invitation cache may describe the previous organization. Let the
        // new query load authoritative post-acceptance state before OAuth resumes.
        queryClient.removeQueries({
          queryKey: ["clisbot", "hub", configuration.origin, "account", null],
          exact: true,
        });
        setConsumedInvitation({ url: currentUrl, id: pendingInvitationId });
        // Preserve the current route and OAuth/PKCE parameters; only the successful
        // invitation is consumed. Failed acceptance keeps its recovery context.
        router.setParams({ invitation: undefined });
      }),
    [configuration.origin, currentUrl, queryClient, router, run, transport],
  );
  const signOut = useCallback(
    () =>
      run(async () => {
        try {
          await transport.signOut();
        } catch (error) {
          await refresh();
          throw error;
        }
      }),
    [run, transport, refresh],
  );
  const updateProfile = useCallback(
    (input: { name?: string; image?: string | null }) =>
      run(() => updateProfileRequest(transport, input)),
    [run, transport],
  );
  const accountState = account.data;
  const activeOrganizationId =
    accountState?.status === "active" || accountState?.status === "appSetupRequired"
      ? accountState.organization.id
      : null;
  const renameOrganization = useCallback(
    (name: string) =>
      run(() =>
        hubUpdateRequest(transport, "/api/auth/organization/update", {
          data: { name },
          ...(activeOrganizationId === null ? {} : { organizationId: activeOrganizationId }),
        }),
      ),
    [activeOrganizationId, run, transport],
  );
  const selectOrganization = useCallback(
    (organizationId: string) =>
      run(() =>
        accountCommand(transport, "/api/auth/clisbot/select-organization", {
          organizationId,
        }),
      ),
    [run, transport],
  );
  const createOrganization = useCallback(
    (name: string) =>
      run(() =>
        accountCommand(transport, "/api/auth/clisbot/create-organization", {
          name,
        }),
      ),
    [run, transport],
  );
  const inviteMember = useCallback(
    (input: { email: string; role: "admin" | "member"; teamId?: string; teamIds?: string[] }) =>
      run(() => accountCommand(transport, "/api/auth/clisbot/create-invitation", input)),
    [run, transport],
  );
  const cancelInvitation = useCallback(
    (pendingInvitationId: string) =>
      run(() =>
        accountCommand(transport, "/api/auth/clisbot/cancel-invitation", {
          invitationId: pendingInvitationId,
        }),
      ),
    [run, transport],
  );
  const changeMemberRole = useCallback(
    (input: { memberId: string; role: "owner" | "admin" | "member" }) =>
      run(() => accountCommand(transport, "/api/auth/clisbot/change-member-role", input)),
    [run, transport],
  );
  const removeMember = useCallback(
    (memberId: string) =>
      run(() =>
        accountCommand(transport, "/api/auth/clisbot/remove-member", {
          memberId,
        }),
      ),
    [run, transport],
  );
  const state = account.data ?? null;
  const signedIn =
    state?.status === "active" || state?.status === "appSetupRequired" ? state : null;
  const api = useCallback(() => {
    if (signedIn === null) throw new Error("Sign in to Hub first.");
    return new HubApiClient(transport, signedIn.organization.id);
  }, [signedIn, transport]);
  const accountError = accountErrorMessage(account.error, account.isError);
  const value = useMemo<HubAccountContextValue>(
    () => ({
      enabled,
      origin: configuration.origin,
      connectionOrigin: configuration.deviceProfile
        ? (configuration.deviceProfile.origin ?? null)
        : configuration.origin,
      signInKind: transport.signInKind,
      googleSignInLabel:
        transport instanceof PairedHubTransport ? transport.googleSignInLabel : undefined,
      state,
      signedIn,
      connection: configuration.deviceProfile ? (connection.data ?? null) : null,
      loading:
        enabled &&
        (account.isPending || Boolean(configuration.deviceProfile && connection.isPending)),
      error: mutationError ?? accountError ?? signInRedirectError(currentUrl),
      signIn,
      signUp,
      startRegistration,
      registrationToken,
      inspectRegistration,
      completeRegistration,
      dismissRegistration,
      updateProfile,
      renameOrganization,
      signInWithGoogle,
      claimInstance,
      completeAppSetup,
      changePassword,
      acceptInvitation,
      signOut,
      selectOrganization,
      createOrganization,
      inviteMember,
      cancelInvitation,
      changeMemberRole,
      removeMember,
      refresh,
      api,
    }),
    [
      enabled,
      accountError,
      account.isPending,
      connection.data,
      connection.isPending,
      configuration.deviceProfile,
      api,
      acceptInvitation,
      configuration.origin,
      currentUrl,
      cancelInvitation,
      changePassword,
      changeMemberRole,
      claimInstance,
      completeAppSetup,
      createOrganization,
      inviteMember,
      mutationError,
      refresh,
      removeMember,
      selectOrganization,
      signIn,
      signInWithGoogle,
      signUp,
      startRegistration,
      registrationToken,
      inspectRegistration,
      completeRegistration,
      dismissRegistration,
      updateProfile,
      renameOrganization,
      signOut,
      signedIn,
      state,
      transport,
    ],
  );
  useLayoutEffect(() => {
    publish(value);
  }, [publish, value]);
  return null;
}

function accountErrorMessage(error: unknown, isError: boolean): string | null {
  if (error instanceof Error) return error.message;
  return isError ? "Hub is unavailable." : null;
}

export function useHubAccount(): HubAccountContextValue {
  return useContext(HubAccountContext);
}

async function readAccountState(
  transport: HubTransport,
  invitationId: string | null,
): Promise<HubAccountState> {
  const path =
    invitationId === null
      ? "/api/auth/clisbot/state"
      : `/api/auth/clisbot/state?invitation=${encodeURIComponent(invitationId)}`;
  const response = await transport.request(path);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new HubAccountRequestError(
      typeof body?.error === "string" ? body.error : "request_failed",
      response.status,
    );
  }
  return HubAccountStateSchema.parse(await response.json());
}

async function accountCommand<Result = void>(
  transport: HubTransport,
  path: string,
  body: unknown,
): Promise<Result> {
  const response = await transport.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    throw new HubAccountRequestError(
      typeof failure?.error === "string" ? failure.error : "request_failed",
      response.status,
    );
  }
  return (await response.json().catch(() => undefined)) as Result;
}

/**
 * Holds a registration link token once the page opens with `?emailRegistration=`, then removes
 * it from the URL so the single-use token stays out of history, bookmarks, and referrers.
 */
function useRegistrationLink(currentUrl: string | null) {
  const router = useRouter();
  const [registrationToken, setRegistrationToken] = useState<string | null>(null);
  const linkToken = queryParameter(currentUrl, "emailRegistration");
  useEffect(() => {
    if (linkToken === null) return;
    setRegistrationToken(linkToken);
    router.setParams({ emailRegistration: undefined });
  }, [linkToken, router]);
  const dismissRegistration = useCallback(() => setRegistrationToken(null), []);
  return { registrationToken, dismissRegistration };
}

async function registrationLinkRequest(
  transport: HubTransport,
  operation: "inspect" | "complete",
  body: object,
): Promise<HubRegistrationLink> {
  const response = await transport.request(`/api/auth/clisbot/registration/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = HubRegistrationLinkSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error(`Hub registration request failed (${response.status}).`);
  return parsed.data;
}

function queryParameter(value: string | null, name: string): string | null {
  if (value === null) return null;
  try {
    return new URL(value).searchParams.get(name)?.trim() || null;
  } catch {
    return null;
  }
}

const UPDATE_ERRORS: Record<string, string> = {
  invalid_profile_name: "Enter a name of up to 100 characters.",
  invalid_profile_image:
    "Use an https image link from a host this Hub trusts, such as a Google or Gravatar photo.",
  invalid_organization_name: "Enter an organization name of up to 100 characters.",
  organization_owner_required: "Only an organization owner can rename the organization.",
};

function updateProfileRequest(
  transport: HubTransport,
  input: { name?: string; image?: string | null },
): Promise<void> {
  return hubUpdateRequest(transport, "/api/auth/update-user", input);
}

/** A Better Auth update call whose refusal code becomes a readable message. */
async function hubUpdateRequest(
  transport: HubTransport,
  path: string,
  body: object,
): Promise<void> {
  const response = await transport.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  const code: unknown = Reflect.get(Object(await response.json().catch(() => ({}))), "code");
  throw new Error(
    (typeof code === "string" ? UPDATE_ERRORS[code] : undefined) ??
      `Hub couldn't save the change (${response.status}).`,
  );
}

/** How a registration-link request ended; `sent` also covers an address that already has an
 * account, which the Hub deliberately does not distinguish. */
export type HubRegistrationStart = "sent" | "domainNotAllowed" | "rateLimited" | "unavailable";

async function startRegistrationRequest(
  transport: HubTransport,
  email: string,
): Promise<HubRegistrationStart> {
  const response = await transport.request("/api/auth/clisbot/registration/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (response.status === 202) return "sent";
  if (response.status === 403) return "domainNotAllowed";
  if (response.status === 429) return "rateLimited";
  return "unavailable";
}

/** Messages for the `?error=` code a refused Google sign-in returns with. */
const GOOGLE_SIGN_IN_ERRORS: Record<string, string> = {
  registration_closed:
    "This Google account isn't admitted to this Hub. Use an invited address or an allowed company domain.",
  google_email_unverified: "Google hasn't verified this email address, so Hub can't use it.",
  account_already_linked_to_different_user:
    "This Google account is linked to a different Hub account. Ask the Hub operator to recover it.",
  google_profile_unavailable:
    "Google didn't return the profile Hub needs. Try signing in with Google again.",
  instance_unavailable:
    "This Hub was already set up by someone else. Sign in with your account instead.",
  unable_to_link_account:
    "Hub doesn't link Google to this account automatically. Sign in with your password.",
  account_not_linked:
    "An account with this email exists, but Google couldn't prove the address. Sign in with your password.",
};

function signInRedirectError(value: string | null): string | null {
  if (value === null) return null;
  try {
    const code = new URL(value).searchParams.get("error");
    return code === null ? null : (GOOGLE_SIGN_IN_ERRORS[code] ?? null);
  } catch {
    return null;
  }
}

function invitationIdFromUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const invitationId = new URL(value).searchParams.get("invitation")?.trim();
    return invitationId ? invitationId : null;
  } catch {
    return null;
  }
}
