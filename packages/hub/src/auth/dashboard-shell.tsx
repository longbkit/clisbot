/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- dynamic tenant URLs are assembled from server-resolved route metadata */
import {
  Blocks,
  Cable,
  Check,
  ChevronsUpDown,
  Cpu,
  CreditCard,
  FolderKanban,
  Gauge,
  History,
  KeyRound,
  LogOut,
  Plus,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { billingConfigured } from "../server/capabilities.js";
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { Page } from "../components/app/page.js";
import { PaseoGlyph } from "../components/app/auth-layout.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import { Separator } from "../components/ui/separator.js";
import { Skeleton } from "../components/ui/skeleton.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "../components/ui/sidebar.js";
import type { ActiveAccountState } from "./organization-contract.js";
import { formValue } from "./account-actions.js";
import { createOrganization, selectOrganization, signOut } from "./functions.js";
import { ErrorSummary } from "./account-states.js";
import { ActiveAccountProvider } from "./active-account.js";
import { FormField } from "./form-field.js";
import type { Result } from "../contract/respond.js";
import { ACCOUNT_MUTATION_KEY, useAccountMutationError } from "./account-mutation.js";
import { useTenantContextMutationPending } from "./tenant-mutation.js";
import { RouteTenantProvider, useOptionalRouteTenant } from "../projects/context.js";

type RouteTenant = NonNullable<ReturnType<typeof useOptionalRouteTenant>>;

type ActiveAccount = ActiveAccountState;
type AccountCommandResult = Result<{
  state: "sessionExpired" | "organizationRequired" | "complete";
}>;
type CreateOrganizationCommandResult = Result<{
  state: "sessionExpired" | "complete";
  organizationSlug?: string;
}>;

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export function DashboardShell({ account }: { account: ActiveAccount }) {
  const organizationTrigger = useRef<HTMLButtonElement>(null);
  const createOrganizationCommand = useAccountCommand(
    useServerFn(createOrganization) as (
      input: Parameters<typeof createOrganization>[0],
    ) => Promise<CreateOrganizationCommandResult>,
  );
  const signOutCommand = useAccountCommand(
    useServerFn(signOut) as (
      input: Parameters<typeof signOut>[0],
    ) => Promise<Result<Record<string, never>>>,
  );
  const selectOrganizationCommand = useAccountCommand(
    useServerFn(selectOrganization) as (
      input: Parameters<typeof selectOrganization>[0],
    ) => Promise<AccountCommandResult>,
  );
  const create = useMutation({
    mutationKey: ACCOUNT_MUTATION_KEY,
    mutationFn: createOrganizationCommand,
    onSuccess: (result) => {
      if (result.status === "ok" && result.data.organizationSlug !== undefined) {
        window.location.assign(`/o/${result.data.organizationSlug}/projects`);
      }
    },
  });
  const select = useMutation({
    mutationKey: ACCOUNT_MUTATION_KEY,
    mutationFn: ({ input }: { input: Parameters<typeof selectOrganization>[0]; slug: string }) =>
      selectOrganizationCommand(input),
    onSuccess: (result, variables) => {
      if (result.status === "ok") window.location.assign(`/o/${variables.slug}/projects`);
    },
  });
  const leave = useMutation({
    mutationKey: ACCOUNT_MUTATION_KEY,
    mutationFn: signOutCommand,
  });
  const tenantContextMutationsPending = useTenantContextMutationPending();
  const tenantContextTransitioning = create.isPending || select.isPending || leave.isPending;
  const failed = useAccountMutationError();
  const createAccount = useCallback((name: string) => create.mutate({ data: { name } }), [create]);
  const selectAccount = useCallback(
    (organizationId: string, slug: string) =>
      select.mutate({ input: { data: { organizationId } }, slug }),
    [select],
  );
  const leaveAccount = useCallback(() => leave.mutate({}), [leave]);
  return (
    <SidebarProvider>
      <RouteTenantProvider>
        <DashboardContent
          account={account}
          organizationTrigger={organizationTrigger}
          busy={tenantContextMutationsPending}
          transitioning={tenantContextTransitioning}
          error={failed}
          onCreateOrganization={createAccount}
          onSelectOrganization={selectAccount}
          onSignOut={leaveAccount}
        />
      </RouteTenantProvider>
    </SidebarProvider>
  );
}

function DashboardContent({
  account,
  organizationTrigger,
  busy,
  transitioning,
  error,
  onCreateOrganization,
  onSelectOrganization,
  onSignOut,
}: {
  account: ActiveAccount;
  organizationTrigger: RefObject<HTMLButtonElement | null>;
  busy: boolean;
  transitioning: boolean;
  error: string | undefined;
  onCreateOrganization: (name: string) => void;
  onSelectOrganization: (organizationId: string, slug: string) => void;
  onSignOut: () => void;
}) {
  const tenant = useOptionalRouteTenant() ?? undefined;
  return (
    <>
      <AppSidebar
        account={account}
        tenant={tenant}
        organizationTrigger={organizationTrigger}
        busy={busy}
        onCreateOrganization={onCreateOrganization}
        onSelectOrganization={onSelectOrganization}
        onSignOut={onSignOut}
      />
      <SidebarInset>
        <SiteHeader
          organization={tenant?.organization.name ?? account.organization.name}
          {...(tenant?.project?.name === undefined ? {} : { project: tenant.project.name })}
        />
        <div className="flex flex-1 flex-col p-4 md:p-8">
          <Page>
            <ErrorSummary message={error} />
            {transitioning ? (
              <AccountTransition />
            ) : (
              <ActiveAccountProvider account={account}>
                <div key={tenant?.project?.id ?? "organization"}>
                  <Outlet />
                </div>
              </ActiveAccountProvider>
            )}
          </Page>
        </div>
      </SidebarInset>
    </>
  );
}

function useAccountCommand<TInput, TResult extends Result<unknown>>(
  command: (input: TInput) => Promise<TResult>,
): (input: TInput) => Promise<TResult> {
  const queryClient = useQueryClient();
  return useCallback(
    async (input: TInput) => {
      const result = await command(input);
      if (result.status === "ok") {
        await queryClient.invalidateQueries({ queryKey: ["account"] });
      }
      return result;
    },
    [command, queryClient],
  );
}

function AccountTransition() {
  return (
    <section aria-label="Loading account context" aria-busy="true" className="grid gap-6">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-64 w-full" />
    </section>
  );
}

function AppSidebar({
  account,
  tenant,
  organizationTrigger,
  busy,
  onCreateOrganization,
  onSelectOrganization,
  onSignOut,
}: {
  account: ActiveAccount;
  tenant: RouteTenant | undefined;
  organizationTrigger: RefObject<HTMLButtonElement | null>;
  busy: boolean;
  onCreateOrganization: (name: string) => void;
  onSelectOrganization: (organizationId: string, slug: string) => void;
  onSignOut: () => void;
}) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <OrganizationSwitcher
          account={account}
          currentOrganization={tenant?.organization ?? account.organization}
          currentRole={tenant?.membership.role ?? account.membership.role}
          activeOrganizationId={tenant?.organization.id ?? account.organization.id}
          trigger={organizationTrigger}
          busy={busy}
          onCreateOrganization={onCreateOrganization}
          onSelectOrganization={onSelectOrganization}
        />
        {tenant?.project === null || tenant?.project === undefined ? null : (
          <nav aria-label="Project switcher">
            <ProjectSwitcher tenant={tenant} />
          </nav>
        )}
      </SidebarHeader>
      <SidebarContent>
        <NavigationGroups
          organizationSlug={tenant?.organization.slug ?? account.organization.slug}
          projectSlug={tenant?.project?.slug}
          canManageResources={account.capabilities.manageResources}
        />
        {account.isInstanceOperator ? <InstanceNavigationGroup /> : null}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <AccountMenu
              email={account.account.email}
              name={account.account.name}
              busy={busy}
              onSignOut={onSignOut}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

const ORGANIZATION_DESTINATIONS = [
  { section: "projects", label: "Projects", icon: FolderKanban },
  { section: "daemons", label: "Daemons", icon: Cpu },
  { section: "connections", label: "Connections", icon: Cable },
  { section: "api-keys", label: "API keys", icon: KeyRound },
  { section: "team", label: "Team", icon: Users },
  { section: "usage", label: "Usage", icon: Gauge },
] as const;
const PROJECT_DESTINATIONS = [
  { section: "overview", label: "Overview", icon: Gauge },
  { section: "configuration", label: "Configuration", icon: SlidersHorizontal },
  { section: "activity", label: "Activity", icon: History },
  { section: "settings/general", label: "Settings", icon: Settings },
] as const;

/**
 * Navigation stays inside the running app. A plain anchor reloads the document, which
 * throws away the resolved account and repaints the pre-auth shell on every hop.
 */
function NavItem({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof FolderKanban;
}) {
  const active = useRouterState({
    select: (state) =>
      state.location.pathname === to ||
      (label === "Settings" && state.location.pathname.startsWith(to.replace(/\/general$/u, ""))),
  });
  const { isMobile, setOpenMobile } = useSidebar();
  // On compact the sidebar is an overlay covering the destination. A document load used
  // to dismiss it; client-side navigation has to dismiss it deliberately.
  const navigate = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        <Link to={to as never} aria-current={active ? "page" : undefined} onClick={navigate}>
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// Rendered from the active account's organization when the route has no tenant of its own — the
// instance-scoped operator page is under the shell but outside /o/, and the sidebar must still let
// the operator get back to their organization's sections.
function NavigationGroups({
  organizationSlug,
  projectSlug,
  canManageResources,
}: {
  organizationSlug: string;
  projectSlug: string | undefined;
  canManageResources: boolean;
}) {
  const organizationBase = `/o/${organizationSlug}`;
  const projectBase =
    projectSlug === undefined ? undefined : `${organizationBase}/projects/${projectSlug}`;
  // Billing is hosted-only: the entry appears solely when the instance is billing-configured, so
  // self-hosted deployments show no billing navigation at all (the route also 404s there).
  const loadBillingConfigured = useServerFn(billingConfigured);
  const billingQuery = useQuery({
    queryKey: ["billing-configured"],
    queryFn: () => loadBillingConfigured(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const billingEnabled = billingQuery.data?.configured === true;
  return (
    <>
      <nav aria-label="Organization">
        <SidebarGroup>
          <div className="px-2 pb-2 text-xs font-medium text-muted-foreground group-data-[collapsible=icon]:sr-only">
            Organization
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {ORGANIZATION_DESTINATIONS.filter(
                (destination) => destination.section !== "api-keys" || canManageResources,
              ).map((destination) => (
                <NavItem
                  key={destination.section}
                  to={`${organizationBase}/${destination.section}`}
                  label={destination.label}
                  icon={destination.icon}
                />
              ))}
              {billingEnabled && (
                <NavItem to={`${organizationBase}/billing`} label="Billing" icon={CreditCard} />
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </nav>
      {projectBase === undefined ? null : (
        <nav aria-label="Project">
          <SidebarGroup>
            <div className="px-2 pb-2 text-xs font-medium text-muted-foreground group-data-[collapsible=icon]:sr-only">
              Project
            </div>
            <SidebarGroupContent>
              <SidebarMenu>
                {PROJECT_DESTINATIONS.map((destination) => (
                  <NavItem
                    key={destination.section}
                    to={`${projectBase}/${destination.section}`}
                    label={destination.label}
                    icon={destination.icon}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      )}
    </>
  );
}

/**
 * Instance-scoped navigation — the operator back office. It lives outside the organization group
 * because an operator acts across organizations, so it renders whether or not a tenant is
 * resolved. Presence here is presentation only: the operator routes enforce the flag server-side.
 */
function InstanceNavigationGroup() {
  return (
    <nav aria-label="Instance">
      <SidebarGroup>
        <div className="px-2 pb-2 text-xs font-medium text-muted-foreground group-data-[collapsible=icon]:sr-only">
          Instance
        </div>
        <SidebarGroupContent>
          <SidebarMenu>
            <NavItem to="/apps" label="Apps" icon={Blocks} />
            <NavItem to="/operator" label="Operator" icon={ShieldCheck} />
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </nav>
  );
}

/**
 * Header context, not a second title. The page owns its `<h1>`; this says where that
 * page sits, which is why it leads with the organization rather than repeating the view.
 */
function SiteHeader({ organization, project }: { organization: string; project?: string }) {
  const title = useRouterState({ select: (state) => viewTitle(state.location.pathname) });
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
      <RestoringSidebarTrigger />
      <Separator orientation="vertical" className="mr-1 h-4" />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="truncate text-muted-foreground">{organization}</span>
        {project === undefined ? null : (
          <>
            <span aria-hidden="true" className="hidden text-muted-foreground/60 sm:inline">
              /
            </span>
            <span className="hidden truncate text-muted-foreground sm:inline">{project}</span>
          </>
        )}
        <span aria-hidden="true" className="text-muted-foreground/60">
          /
        </span>
        <span className="truncate">{title}</span>
      </nav>
    </header>
  );
}

function viewTitle(pathname: string): string {
  const section = routeSection(pathname);
  return section === undefined ? "Register daemon" : section.label;
}

function RestoringSidebarTrigger() {
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const { isMobile, openMobile } = useSidebar();

  useEffect(() => {
    if (isMobile && wasOpen.current && !openMobile) trigger.current?.focus();
    wasOpen.current = openMobile;
  }, [isMobile, openMobile]);

  return <SidebarTrigger ref={trigger} className="-ml-1" />;
}

/**
 * Switching organization is a choice, not a form submission — picking a membership
 * applies it. Creating one is the low-frequency action at the bottom of the same menu.
 */
function OrganizationSwitcher({
  account,
  currentOrganization,
  currentRole,
  activeOrganizationId,
  trigger,
  busy,
  onCreateOrganization,
  onSelectOrganization,
}: {
  account: ActiveAccount;
  currentOrganization: { id: string; name: string };
  currentRole: string;
  activeOrganizationId: string;
  trigger: RefObject<HTMLButtonElement | null>;
  busy: boolean;
  onCreateOrganization: (name: string) => void;
  onSelectOrganization: (organizationId: string, slug: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const requestCreate = useCallback((event: Event) => {
    event.preventDefault();
    setCreating(true);
  }, []);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              ref={trigger}
              size="lg"
              aria-label="Organization"
              tooltip={currentOrganization.name}
              className="data-[state=open]:bg-sidebar-accent"
            >
              <span className="flex aspect-square size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <PaseoGlyph />
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{currentOrganization.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {ROLE_LABELS[currentRole] ?? currentRole}
                </span>
              </span>
              <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="bottom"
            sideOffset={4}
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          >
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            {account.memberships.map((membership) => (
              <OrganizationItem
                key={membership.id}
                id={membership.id}
                name={membership.name}
                slug={membership.slug}
                selected={membership.id === activeOrganizationId}
                busy={busy}
                onSelect={onSelectOrganization}
              />
            ))}
            {account.canCreateOrganization ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={busy} onSelect={requestCreate}>
                  <Plus aria-hidden="true" />
                  New organization
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <CreateOrganizationDialog
          open={creating}
          onOpenChange={setCreating}
          busy={busy}
          onCreate={onCreateOrganization}
        />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function OrganizationItem({
  id,
  name,
  slug,
  selected,
  busy,
  onSelect,
}: {
  id: string;
  name: string;
  slug: string;
  selected: boolean;
  busy: boolean;
  onSelect: (organizationId: string, slug: string) => void;
}) {
  const handleSelect = useCallback(() => {
    onSelect(id, slug);
  }, [id, onSelect, slug]);

  return (
    <DropdownMenuItem
      disabled={busy}
      aria-current={selected ? "true" : undefined}
      data-organization-id={id}
      onSelect={handleSelect}
    >
      <span className="truncate">{name}</span>
      {selected ? <Check aria-hidden="true" className="ml-auto" /> : null}
    </DropdownMenuItem>
  );
}

function ProjectSwitcher({ tenant }: { tenant: RouteTenant }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const route = routeSection(pathname);
  const section =
    route !== undefined && "projectSection" in route ? route.projectSection : "overview";
  const activeProjects = tenant.projects.filter((project) => project.status === "active");
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              aria-label="Project"
              tooltip={tenant.project?.name ?? "Project"}
            >
              <FolderKanban aria-hidden="true" />
              <span className="truncate">{tenant.project?.name}</span>
              <ChevronsUpDown aria-hidden="true" className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="min-w-56">
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            {activeProjects.map((project) => (
              <DropdownMenuItem key={project.id} asChild>
                <Link
                  to={`/o/${tenant.organization.slug}/projects/${project.slug}/${section}` as never}
                  aria-current={project.id === tenant.project?.id ? "true" : undefined}
                >
                  <span className="truncate">{project.name}</span>
                  {project.id === tenant.project?.id ? (
                    <Check aria-hidden="true" className="ml-auto" />
                  ) : null}
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to={`/o/${tenant.organization.slug}/projects` as never}>All projects</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

const ROUTE_SECTIONS = [
  { suffix: "/settings/general", label: "Settings", projectSection: "settings/general" },
  { suffix: "/configuration", label: "Configuration", projectSection: "configuration" },
  { suffix: "/activity", label: "Activity", projectSection: "activity" },
  { suffix: "/overview", label: "Overview", projectSection: "overview" },
  { suffix: "/projects", label: "Projects" },
  { suffix: "/daemons", label: "Daemons" },
  { suffix: "/connections", label: "Connections" },
  { suffix: "/api-keys", label: "API keys" },
  { suffix: "/team", label: "Team" },
  { suffix: "/usage", label: "Usage" },
  { suffix: "/billing", label: "Billing" },
  { suffix: "/apps", label: "Apps" },
  { suffix: "/operator", label: "Operator" },
] as const;

function routeSection(pathname: string) {
  return ROUTE_SECTIONS.find((route) => pathname.endsWith(route.suffix));
}

function CreateOrganizationDialog({
  open,
  onOpenChange,
  busy,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onCreate: (name: string) => void;
}) {
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      onCreate(formValue(new FormData(event.currentTarget), "name"));
      onOpenChange(false);
    },
    [onCreate, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New organization</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} aria-label="Create organization" className="grid gap-6">
          <FormField label="Organization name" name="name" id="new-organization-name" />
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              Create organization
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccountMenu({
  email,
  name,
  busy,
  onSignOut,
}: {
  email: string;
  name: string;
  busy: boolean;
  onSignOut: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          aria-label={email}
          tooltip={email}
          className="data-[state=open]:bg-sidebar-accent"
        >
          <span className="flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-accent text-xs font-medium">
            {initials(name, email)}
          </span>
          <span className="grid flex-1 text-left leading-tight">
            <span className="truncate text-sm">{name}</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          </span>
          <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={4}
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
      >
        <DropdownMenuItem disabled={busy} onSelect={onSignOut}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initials(name: string, email: string): string {
  const source = name.trim().length > 0 ? name.trim() : email;
  const parts = source.split(/[\s@.]+/u).filter((part) => part.length > 0);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
