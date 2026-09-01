/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- dynamic tenant URLs are assembled from server-resolved route metadata */
import {
  ArrowLeft,
  Blocks,
  Cable,
  Check,
  ChevronsUpDown,
  Cpu,
  FolderKanban,
  Gauge,
  History,
  LogOut,
  Plus,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { cn } from "../lib/utils.js";
import { Page } from "../components/app/page.js";
import {
  SiteHeaderActionsProvider,
  SiteHeaderActionsTarget,
} from "../components/app/site-header-actions.js";
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
  SidebarSeparator,
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
        window.location.assign(`/o/${result.data.organizationSlug}/triggers`);
      }
    },
  });
  const select = useMutation({
    mutationKey: ACCOUNT_MUTATION_KEY,
    mutationFn: ({ input }: { input: Parameters<typeof selectOrganization>[0]; slug: string }) =>
      selectOrganizationCommand(input),
    onSuccess: (result, variables) => {
      if (result.status === "ok") window.location.assign(`/o/${variables.slug}/triggers`);
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
  const instance = useInstanceScope(account.isInstanceOperator);
  return (
    <>
      <AppSidebar
        account={account}
        tenant={tenant}
        instance={instance}
        organizationTrigger={organizationTrigger}
        busy={busy}
        onCreateOrganization={onCreateOrganization}
        onSelectOrganization={onSelectOrganization}
        onSignOut={onSignOut}
      />
      <SiteHeaderActionsProvider>
        <SidebarInset>
          <SiteHeader
            scope={instance ? "Instance" : (tenant?.organization.name ?? account.organization.name)}
            {...(instance || tenant?.project == null ? {} : { project: tenant.project.name })}
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
      </SiteHeaderActionsProvider>
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
  instance,
  organizationTrigger,
  busy,
  onCreateOrganization,
  onSelectOrganization,
  onSignOut,
}: {
  account: ActiveAccount;
  tenant: RouteTenant | undefined;
  instance: boolean;
  organizationTrigger: RefObject<HTMLButtonElement | null>;
  busy: boolean;
  onCreateOrganization: (name: string) => void;
  onSelectOrganization: (organizationId: string, slug: string) => void;
  onSignOut: () => void;
}) {
  // The sidebar header stacks one switcher per level of where you are: organization, then
  // project. The body lists destinations for the innermost level only. Anything outside the
  // organization → project chain — instance, account — enters through the footer account menu.
  // Location accumulates; destinations swap.
  const project = tenant?.project ?? null;
  const organization = tenant?.organization ?? account.organization;
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {instance ? (
          <InstanceHeader />
        ) : (
          <>
            <OrganizationSwitcher
              account={account}
              currentOrganization={organization}
              currentRole={tenant?.membership.role ?? account.membership.role}
              activeOrganizationId={organization.id}
              trigger={organizationTrigger}
              busy={busy}
              onCreateOrganization={onCreateOrganization}
              onSelectOrganization={onSelectOrganization}
            />
            {tenant === undefined || tenant.project === null ? null : (
              <ProjectSwitcher tenant={tenant} />
            )}
          </>
        )}
      </SidebarHeader>
      <SidebarContent>
        <Destinations instance={instance} organization={organization} project={project} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <AccountMenu
              email={account.account.email}
              name={account.account.name}
              operator={account.isInstanceOperator}
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

/** The innermost level's destinations, and only those. Each group owns its own way back out. */
function Destinations({
  instance,
  organization,
  project,
}: {
  instance: boolean;
  organization: { name: string; slug: string };
  project: { slug: string } | null;
}) {
  if (instance) return <InstanceNavigationGroup organization={organization} />;
  if (project === null) return <OrganizationNavigationGroup organizationSlug={organization.slug} />;
  return <ProjectNavigationGroup organizationSlug={organization.slug} projectSlug={project.slug} />;
}

// Work, then administration. Team, API keys, Usage, and Billing are configured once and read
// occasionally, so they sit behind Settings rather than competing with the three surfaces an
// operator opens daily.
const ORGANIZATION_DESTINATIONS = [
  { section: "triggers", label: "Triggers", icon: Zap, subtree: true },
  { section: "activity", label: "Activity", icon: History },
  { section: "daemons", label: "Daemons", icon: Cpu },
  { section: "connections", label: "Connections", icon: Cable },
  { section: "settings", label: "Settings", icon: Settings, subtree: true },
] as const;
const PROJECT_DESTINATIONS = [
  { section: "overview", label: "Overview", icon: Gauge },
  { section: "configuration", label: "Configuration", icon: SlidersHorizontal },
  { section: "activity", label: "Activity", icon: History },
  { section: "settings", label: "Settings", icon: Settings },
] as const;
// The instance is the deployment, so its surfaces sit outside `/o/` and there is no tenant in
// their paths. That also makes the path the only thing that can say you are on one.
const INSTANCE_DESTINATIONS = [
  { to: "/apps", label: "Apps", icon: Blocks },
  { to: "/operator", label: "Operator", icon: ShieldCheck },
] as const;
const INSTANCE_ENTRY = INSTANCE_DESTINATIONS[0].to;

/**
 * Instance scope is a property of the user, not of a tenant, so a non-operator on an instance
 * route keeps the organization sidebar and their way back out — the route itself refuses them.
 */
function useInstanceScope(operator: boolean): boolean {
  const onInstanceRoute = useRouterState({
    select: (state) =>
      INSTANCE_DESTINATIONS.some((destination) => destination.to === state.location.pathname),
  });
  return operator && onInstanceRoute;
}

/**
 * Navigation stays inside the running app. A plain anchor reloads the document, which
 * throws away the resolved account and repaints the pre-auth shell on every hop.
 */
function NavItem({
  to,
  label,
  icon: Icon,
  subtree = false,
}: {
  to: string;
  label: string;
  icon: typeof FolderKanban;
  /** The destination owns pages beneath it, so it stays lit while any of them is open. */
  subtree?: boolean;
}) {
  const active = useRouterState({
    select: (state) =>
      state.location.pathname === to || (subtree && state.location.pathname.startsWith(`${to}/`)),
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

// Some shell routes carry no tenant of their own — the instance surfaces sit outside /o/, and a
// non-operator who reaches one is refused there rather than moved into instance scope. The slug
// then comes from the active account, so the sidebar still offers a way somewhere.
function OrganizationNavigationGroup({ organizationSlug }: { organizationSlug: string }) {
  const organizationBase = `/o/${organizationSlug}`;
  return (
    <nav aria-label="Organization">
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {ORGANIZATION_DESTINATIONS.map((destination) => (
              <NavItem
                key={destination.section}
                to={`${organizationBase}/${destination.section}`}
                label={destination.label}
                icon={destination.icon}
                subtree={"subtree" in destination}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </nav>
  );
}

function ProjectNavigationGroup({
  organizationSlug,
  projectSlug,
}: {
  organizationSlug: string;
  projectSlug: string;
}) {
  const projectBase = `/o/${organizationSlug}/projects/${projectSlug}`;
  return (
    <nav aria-label="Project">
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <NavItem to={`/o/${organizationSlug}/projects`} label="All projects" icon={ArrowLeft} />
          </SidebarMenu>
        </SidebarGroupContent>
        <SidebarSeparator className="my-2" />
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
  );
}

/**
 * The operator back office. Instance routes carry no tenant, so the way back out is named after
 * the organization the account is active in — the one the sidebar would show anywhere else.
 * Presence here is presentation only: the operator routes enforce the flag server-side.
 */
function InstanceNavigationGroup({
  organization,
}: {
  organization: { name: string; slug: string };
}) {
  return (
    <nav aria-label="Instance">
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <NavItem
              to={`/o/${organization.slug}/triggers`}
              label={`Back to ${organization.name}`}
              icon={ArrowLeft}
            />
          </SidebarMenu>
        </SidebarGroupContent>
        <SidebarSeparator className="my-2" />
        <SidebarGroupContent>
          <SidebarMenu>
            {INSTANCE_DESTINATIONS.map((destination) => (
              <NavItem
                key={destination.to}
                to={destination.to}
                label={destination.label}
                icon={destination.icon}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </nav>
  );
}

/** There is one instance and nothing to switch to, so the header slot holds a label, not a menu. */
function InstanceHeader() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex h-12 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-0!">
          <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ShieldCheck aria-hidden="true" className="size-4" />
          </span>
          <span className="grid flex-1 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate">Instance</span>
            <span className="truncate text-xs text-muted-foreground">Administration</span>
          </span>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * Header context, not a second title. The page owns its `<h1>`; this says where that page sits,
 * which is why it leads with where you are — the same scope the sidebar header stacks — rather
 * than repeating the view.
 */
function SiteHeader({ scope, project }: { scope: string; project?: string }) {
  const trail = useRouterState({ select: (state) => viewTrail(state.location.pathname) });
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
      <RestoringSidebarTrigger />
      <Separator orientation="vertical" className="mr-1 h-4" />
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1.5 overflow-hidden text-sm"
      >
        <span className="truncate text-muted-foreground">{scope}</span>
        {project === undefined ? null : (
          <>
            <span aria-hidden="true" className="hidden text-muted-foreground/60 sm:inline">
              /
            </span>
            <span className="hidden truncate text-muted-foreground sm:inline">{project}</span>
          </>
        )}
        {trail.map((entry, index) => (
          <Fragment key={entry}>
            <span aria-hidden="true" className="text-muted-foreground/60">
              /
            </span>
            <span
              className={cn(
                "truncate",
                index < trail.length - 1 && "hidden text-muted-foreground sm:inline",
              )}
            >
              {entry}
            </span>
          </Fragment>
        ))}
      </nav>
      <SiteHeaderActionsTarget />
    </header>
  );
}

function viewTrail(pathname: string): string[] {
  if (/\/triggers\/[^/]+$/u.test(pathname)) return ["Triggers", "Trigger editor"];
  const section = routeSection(pathname);
  if (section === undefined) return ["Register daemon"];
  return "group" in section ? [section.group, section.label] : [section.label];
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
                <span className="truncate text-sm">{currentOrganization.name}</span>
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
            {/* One line, and no organization on it: the organization switcher is the row directly
                above, so repeating it here would say the same thing twice. */}
            <SidebarMenuButton
              aria-label="Project"
              tooltip={tenant.project?.name ?? "Project"}
              className="data-[state=open]:bg-sidebar-accent"
            >
              <FolderKanban aria-hidden="true" />
              <span className="truncate">{tenant.project?.name}</span>
              <ChevronsUpDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
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

// Longest suffix first: an organization settings path ends with `/settings/team`, a project
// settings path ends with `/settings`, and only the first match may win.
const ROUTE_SECTIONS = [
  { suffix: "/settings/api-keys", label: "API keys", group: "Settings" },
  { suffix: "/settings/team", label: "Team", group: "Settings" },
  { suffix: "/settings/usage", label: "Usage", group: "Settings" },
  { suffix: "/settings/billing", label: "Billing", group: "Settings" },
  { suffix: "/settings", label: "Settings", projectSection: "settings" },
  { suffix: "/configuration", label: "Configuration", projectSection: "configuration" },
  { suffix: "/activity", label: "Activity", projectSection: "activity" },
  { suffix: "/overview", label: "Overview", projectSection: "overview" },
  { suffix: "/triggers", label: "Triggers" },
  { suffix: "/projects", label: "Projects" },
  { suffix: "/daemons", label: "Daemons" },
  { suffix: "/connections", label: "Connections" },
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

/**
 * The account menu carries what belongs to the person rather than to a tenant. Instance
 * administration is one of those: `is_instance_operator` is a property of the user, so no
 * position inside the organization → project sidebar would be true.
 */
function AccountMenu({
  email,
  name,
  operator,
  busy,
  onSignOut,
}: {
  email: string;
  name: string;
  operator: boolean;
  busy: boolean;
  onSignOut: () => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  // On compact the menu opens inside the drawer covering the destination, so leaving for the
  // instance has to dismiss it the way a sidebar destination does.
  const navigate = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          aria-label={email}
          tooltip={email}
          className="data-[state=open]:bg-sidebar-accent"
        >
          <span className="flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-accent text-xs">
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
        {operator ? (
          <>
            <DropdownMenuItem asChild>
              <Link to={INSTANCE_ENTRY} onClick={navigate}>
                <ShieldCheck aria-hidden="true" />
                Instance administration
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
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
