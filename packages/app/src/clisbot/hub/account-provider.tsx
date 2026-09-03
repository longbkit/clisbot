import * as Linking from "expo-linking";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { useFetchQuery } from "@/data/query";
import { HubApiClient } from "./api-client";
import { getHubConfiguration, type HubConfiguration } from "./config";
import { HubAccountStateSchema, type HubAccountState, type HubSignedInState } from "./contracts";
import { createHubTransport } from "./transport/create";
import type { HubTransport } from "./transport/contract";

interface HubAccountContextValue {
  enabled: boolean;
  origin: string | null;
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
  claimInstance(input: { email: string; password: string }): Promise<void>;
  completeAppSetup(): Promise<void>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
  acceptInvitation(invitationId: string): Promise<void>;
  signOut(): Promise<void>;
  selectOrganization(organizationId: string): Promise<void>;
  createOrganization(name: string): Promise<void>;
  inviteMember(input: { email: string; role: "admin" | "member"; teamId?: string }): Promise<void>;
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

export function HubAccountProvider({ children }: { children: ReactNode }) {
  const configuration = useMemo(() => getHubConfiguration(), []);
  if (configuration === null) return children;
  return (
    <EnabledHubAccountProvider configuration={configuration}>{children}</EnabledHubAccountProvider>
  );
}

function EnabledHubAccountProvider({
  configuration,
  children,
}: {
  configuration: HubConfiguration;
  children: ReactNode;
}) {
  const transport = useMemo(() => createHubTransport(configuration), [configuration]);
  const currentUrl = Linking.useURL();
  const invitationId = useMemo(() => invitationIdFromUrl(currentUrl), [currentUrl]);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const account = useFetchQuery({
    queryKey: ["clisbot", "hub", configuration.origin, "account", invitationId],
    queryFn: () => readAccountState(transport, invitationId),
    dataShape: "value",
    retry: false,
    staleTimeMs: 15_000,
  });
  const refresh = useCallback(async () => {
    await account.refetch();
  }, [account]);
  const run = useCallback(
    async (operation: () => Promise<void>) => {
      setMutationError(null);
      try {
        await operation();
        await account.refetch();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Hub request failed.";
        setMutationError(message);
        throw error;
      }
    },
    [account],
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
  const claimInstance = useCallback(
    (input: { email: string; password: string }) =>
      run(async () => {
        const response = await accountCommand<{ state: "claimed" | "unavailable" }>(
          transport,
          "/api/auth/paseo/claim-instance",
          input,
        );
        if (response.state === "unavailable") {
          throw new Error("This Hub has already been set up. Sign in with an existing account.");
        }
      }),
    [run, transport],
  );
  const changePassword = useCallback(
    (input: { currentPassword: string; newPassword: string }) =>
      run(() => accountCommand(transport, "/api/auth/change-password", input)),
    [run, transport],
  );
  const completeAppSetup = useCallback(
    () => run(() => accountCommand(transport, "/api/auth/paseo/complete-app-setup", {})),
    [run, transport],
  );
  const acceptInvitation = useCallback(
    (pendingInvitationId: string) =>
      run(() =>
        accountCommand(transport, "/api/auth/paseo/accept-invitation", {
          invitationId: pendingInvitationId,
        }),
      ),
    [run, transport],
  );
  const signOut = useCallback(() => run(() => transport.signOut()), [run, transport]);
  const selectOrganization = useCallback(
    (organizationId: string) =>
      run(() =>
        accountCommand(transport, "/api/auth/paseo/select-organization", { organizationId }),
      ),
    [run, transport],
  );
  const createOrganization = useCallback(
    (name: string) =>
      run(() => accountCommand(transport, "/api/auth/paseo/create-organization", { name })),
    [run, transport],
  );
  const inviteMember = useCallback(
    (input: { email: string; role: "admin" | "member"; teamId?: string }) =>
      run(() => accountCommand(transport, "/api/auth/paseo/create-invitation", input)),
    [run, transport],
  );
  const cancelInvitation = useCallback(
    (pendingInvitationId: string) =>
      run(() =>
        accountCommand(transport, "/api/auth/paseo/cancel-invitation", {
          invitationId: pendingInvitationId,
        }),
      ),
    [run, transport],
  );
  const changeMemberRole = useCallback(
    (input: { memberId: string; role: "owner" | "admin" | "member" }) =>
      run(() => accountCommand(transport, "/api/auth/paseo/change-member-role", input)),
    [run, transport],
  );
  const removeMember = useCallback(
    (memberId: string) =>
      run(() => accountCommand(transport, "/api/auth/paseo/remove-member", { memberId })),
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
      enabled: true,
      origin: configuration.origin,
      signInKind: transport.signInKind,
      state,
      signedIn,
      loading: account.isPending,
      error: mutationError ?? accountError,
      signIn,
      signUp,
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
      accountError,
      account.isPending,
      api,
      acceptInvitation,
      configuration.origin,
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
      signUp,
      signOut,
      signedIn,
      state,
      transport.signInKind,
    ],
  );
  return <HubAccountContext.Provider value={value}>{children}</HubAccountContext.Provider>;
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
      ? "/api/auth/paseo/state"
      : `/api/auth/paseo/state?invitation=${encodeURIComponent(invitationId)}`;
  const response = await transport.request(path);
  if (!response.ok) throw new Error(`Hub account request failed (${response.status}).`);
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
  if (!response.ok) throw new Error(`Hub account request failed (${response.status}).`);
  return (await response.json().catch(() => undefined)) as Result;
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
