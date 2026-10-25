# Paseo v0.13.0 integration

Status: candidate under validation. **Not accepted or promoted to main.** The
Owner requested the latest upstream integration, two independent reviews, and
complete E2E/CI with repairs. This is a source integration, not a Clisbot release.
Clisbot package versions remain `2.1.8`. No published assets, production daemon,
Hub, pairing, saved credentials, or Owner review servers are changed by this work.

Procedure: [upstream sync playbook](../../guides/developer-guide/upstream-sync-and-contribution.md).

## Inputs and merge

| Role                               | Revision                                              |
| ---------------------------------- | ----------------------------------------------------- |
| Clisbot pre-merge                  | `c2dc4ad90306163dabdb060280325700cbf145f1`            |
| Previous sync merge                | `f2cf565bf688e6a7165854d6fa9b6e05e3c65738`            |
| Raw merge base                     | `337e81a9c6d4551dbcede5930c21408776d06b1b`            |
| Paseo release                      | `v0.13.0`, `d34d17a9072149320ace35ec2a2e5c7dcd992cb3` |
| Transformed snapshot               | `697dd848231ba374381ed5a59394bc81afc2c1b2`            |
| Separately inspected upstream main | `566218d682d2853085a08cb4001c549c2a71c481`            |

The release contributes 247 upstream commits after the prior raw baseline.
Three commits after the release on upstream main are outside this promotion.
The merge retains both histories through the renamed snapshot. Raw upstream
tags are kept under a separate ref namespace, not Clisbot product tags.

The raw merge had 519 conflicts. Normalizing the old upstream base classified
100 paths as keeping Clisbot, 139 as taking upstream, 79 as clean three-way
merges, 162 as manual joins, and 39 as one-sided changes. Git index resolution
was followed by content scanning: two eight-character conflict markers in native
module package manifests were found and repaired before validation.

Manifests preserve Clisbot package identity, Hub/channels, current publication
scripts, and the Owner-merged PostgreSQL pool fix and default-OFF provider retry.
Expo 57 and React Native 0.86 dependencies are reconciled in the lockfile. The
renamed upstream snapshot contains all 6,038 expected paths plus four branding
assets. Final integrated survival and completeness are separate acceptance gates.

## Semantic joins and review

The integration keeps durable message submissions, pure attachment prompts,
sender provenance, review-mode controls, managed Project authorization, Host
links, Bot/group conversations, session storage, schedules, and channel routes.
New upstream presentation and navigation use the existing Clisbot boundaries.

Confirmed findings corrected during review include:

- Direct pairing and relay upgrades retain the actual transport credential and
  security contract; an early secure-channel open cannot run before assignment.
- Project-scoped or revoked origins cannot borrow saved Host credentials through
  JSON, WebSocket fast paths, or late binary frames. Derived routes close when
  authority is revoked.
- Managed agent Host operations and remote finish observers recheck current
  authority, including before queued notifications dispatch. Different trusted
  message contexts remain separate through batching and shutdown.
- Compact conversation panels preserve dirty file tabs and use the actual
  workspace authority rather than synthetic conversation keys. Delayed hydration
  cannot overwrite current tabs, and revoked targets cannot mount descriptors.
- Expo 57 embeds its React Navigation contexts. Six remaining consumers moved to
  the public `expo-router/react-navigation` entry point; a real Home browser
  journey reproduced the prior context crash and verified the correction.
- Browser compact navigation does not register native-only hardware Back.
- The Home tab bar and compact tab choices publish actual selection through the
  supported ARIA props. The old tab-bar unit mock synthesized an attribute the
  real browser did not receive; the mock and actual browser assertions now agree.
- Default compact Work reaches upstream file search through Workspace actions,
  preserving the current Host/workspace. The existing command center and file
  sheet own execution; missing directory, connection or matching route disables
  the action. The Home V2 rollback mode keeps its existing sidebar entry point.

The final independent review found that an injected Agent MCP capability could
omit its caller selector and inherit operator privileges. HTTP requests now carry
their authenticated credential authority into the saved-Host resolver. Missing
or replaced selectors cannot confer operator access. An actual configured daemon
password retains its existing operator admission; pairing continues to reject
password admission, and personal/no-Hub behavior stays available. Independent
source closure and actual HTTP, authentication, managed-MCP, Session, relay and
client lifecycle regression tests pass.

The new press-feedback rule retains upstream's exemptions and adds only 62 exact
Clisbot paths whose bytes match the pre-merge baseline. This is tracked legacy
debt, not an exemption for new code. See [the inventory](press-feedback-debt.json).

## Validation status

Evidence is held by the CTO workspace at
`artifacts/evidence/upstream-paseo-20261024/state.json`, with command logs,
reports, and isolated worktrees under `/Volumes/Media/clisbot-upstream-20261024`.
Counts below are individual runs, not additive coverage totals.

- Clean candidate install and workspace dependency inspection pass.
- Server/channel/client/CLI builds, workspace typecheck, lint, and formatting
  have passed; changed source must satisfy the final normal commit hooks.
- Rebrand 16, protocol 105, transport 17, endpoint 18, navigation 90, app runtime
  163, compact conversation 181, and Expo navigation/Back 38 targeted tests pass.
- Focused actual browser Home/Settings and mobile Chat/Work/empty-workspace/Back
  journeys pass. These use an isolated real daemon with test provider adapters;
  they are not evidence of a real provider turn or native app acceptance.
- Full browser attempt 1 stopped after five failures caused by the reproduced
  navigation crash. Attempt 2 had 36 passing cases and five failures before
  fail-fast stopped further coverage; 935 cases were unrun or conditionally
  skipped, not accepted as passing. All five observed failures now pass their
  focused reruns. Provider removal uses the actual application dialog; compact
  Project creation explicitly selects the browsed folder; layout tests opt into
  the detailed tool presentation they inspect.
- Compact Search/Import/Project cancellation and import, exact selected-agent
  navigation, and Project creation pass actual browser reruns. File search reads
  the exact file contents, closes its sheet and retains its Work owner with Home
  V2 both enabled and disabled. The rollback-mode case exercises ordinary saved
  navigation-Search preferences, whose entry deliberately retains the sidebar.
- The logical receipt E2E through two actual daemons, the real CLI and automatic
  completion passes after correcting fixture assumptions about parsed optional
  provenance fields and the queued API's ID.
- Bot/schedule survival 138, session storage 29, Hub registry/PostgreSQL 32,
  app locale contracts 41, native-ESM loader, in-repo vertical contracts and
  simulated Slack/Telegram channel boot 11 pass. One opt-in storage ceiling case
  and two absent pinned published-supply cases are skipped; their scope is unproved.
- Full candidate GitHub CI, current packaged web tour, real provider/Bot/schedule
  flow, Android assembly/launch, and iOS compile/launch remain pending.

The pre-merge main CI run `40095661340` failed two browser shards. Its failures
are retained as baseline evidence, not silently attributed to this merge or
accepted as an exception. Candidate failures still require diagnosis and repair.

Android module unit tests in CI do not assemble or launch the whole app. There
is no iOS native build/launch job. Browser results cannot certify SceneDelegate,
paste, deep links, native terminal, keyboard, or enriched Markdown behavior.

## Promotion and recovery

`upstream-baseline.json` remains unchanged until acceptance. The candidate must
pass final source survival, completeness, relevant regression and E2E checks,
independent finding closure, and required CI before local-main promotion. Any
remaining platform limitation must be explicit; an unrun gate is not green.

Before promotion, abandoning the isolated branch leaves main and Owner services
unchanged. After integration, undoing source requires a reviewed merge revert;
it does not imply a runtime rollback, release, or permission to restart services.

## First full CI and corrective follow-through

Candidate `7c4446ad7d416374d6a84d26b8105e31e386d363` was pushed only to
`sync/promotion-v0.13.0`. Full CI run `40141748790` completed with failures; it is
not an acceptance receipt. Linux/Windows Desktop, three CLI shards, macOS file
observation, Windows server integration and two browser shards passed. Other
server, quality, website, app and browser jobs exposed repairs retained in the
evidence directory; no unchanged failed run is relabeled green.

The corrective source retains structured RPC error diagnostics in the client
fixture, fixes Hub heartbeat failure completion, and corrects the OpenCode test
storage namespace. Focused client219/server32 checks passed. Website content
checks passed549 using the actual CI command. Inherited Chinese hosted-service
claims and15 divergent translated guides are archived with raw provenance;
explicit English fallback is shown for those guides rather than publishing
claims for an unimplemented Clisbot service. This is not full Chinese coverage.

Browser tests now use the actual Home V2/legacy navigation and translated
confirmation surfaces without removing their geometry, dirty-draft, exact-file,
permission-ledger or workspace-identity assertions. Expo browser-test interop
uses the real web core and embedded Markdown WASM; that interop is scoped to
the browser project, preserving Node unit imports.

Actual Settings reproduction found a second pop after browser Back had already
returned to the first app entry. The versioned Expo Router history patch and
install registry prevent that extra pop. Removing a Host also unmounted its
nested navigator and serialized its workspace as a Host query; retaining the
navigator while replacing inaccessible leaf content preserves the original
reader URL. All12 Settings browser journeys passed after both fixes, including
Home/Chat/Session entry return and Forward. Focused Host composition tests11
passed; these do not certify native navigator lifetime.

Directly connected remote-Host E2E exposed a canceled directory subscription
whose same-connection reacquisition reused the canceled refresh. Generation
tracking now reacquires once when demand returns, preserving ordinary backend
failure behavior without automatic retry. Actual two-Host E2E passed and the
whole directory unit file35 passed. The exact browser producer of the original
release is inferred from the Host-discovery demand lifecycle, not instrumented.

Independent review accepted these scoped repairs. Separate preexisting P2
`IC-DIR-01` remains open: cancellation/disposal while initial cache hydration is
pending can admit an unneeded subscription after the last consumer leaves.
Runtime reproduction of that adjacent path is unrun; no complete cancellation
cleanup, data-loss or cross-Host exposure claim is made.

The packaged7c web build completed and one real Codex turn returned exactly
`OK`; four actual whole-screen web captures were inspected. Later repairs have
not yet been rebuilt into that package. Android prebuild passed; the first
Gradle build was intentionally stopped after920s to prioritize CI correction,
with task-owned caches preserved. There is no APK/launch or iOS acceptance yet.
New-head full CI, final source checks, packaged Bot/schedule/tour and native
gates remain open before promotion.

Latest focused closure also passed both offline remote-Host contracts: a never-opened
workspace keeps its qualified route and cached sidebar behind the existing connection
gate; an already-open workspace retains the identical pane/child DOM nodes and
unsent draft after transport loss. The original fixture had expected warm content
on its first offline open, contrary to the pre-merge documented cold-open contract.
The corrected fixture adds both sides rather than removing retention coverage.

Final local browser component coverage is32files/232tests passing. The two repaired
legacy drawer journeys and both Manual-order journeys passed. Format and lint are
clean; final typecheck and normal commit hooks bind acceptance to the next candidate
commit, whose full CI is still required. Per-run counts here overlap and are not an
additive count of unique tests.
