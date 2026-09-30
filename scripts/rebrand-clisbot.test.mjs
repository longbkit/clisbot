import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./rebrand-clisbot.mjs", import.meta.url));

test("rebrands service ports without changing timers, evidence, or stored user settings", () => {
  const root = mkdtempSync(join(tmpdir(), "clisbot-rebrand-ports-"));
  git(root, "init", "-q");
  const files = {
    "packages/server/src/server/config.ts": "const DEFAULT_PORT = 6767;\n",
    "packages/protocol/src/ssh-transport.ts": "export const DEFAULT_SSH_DAEMON_PORT = 6767;\n",
    "packages/app/src/runtime/host-runtime.ts": 'const endpoint = "localhost:6767";\n',
    "packages/hub/src/index.ts":
      'const port = process.env["PORT"] ?? "3000";\nconst timeout = 3000;\n',
    "packages/cli/src/commands/hub/local-hub.ts": "const FORK_DEFAULT_HUB_PORT = 6868;\n",
    "packages/app/e2e/support/helpers/daemon-port.ts":
      'if (port === "6767") throw Error("reserved");\n',
    "docker/base/Dockerfile": "EXPOSE 6767 3000\n",
    "scripts/dev-app.sh": 'export PASEO_LISTEN="${PASEO_LISTEN:-127.0.0.1:6768}"\n',
    "docs/audits/old.md": "6767 6768 3000 6868\n",
    "user-state/settings.json": '{"listen":"127.0.0.1:6767"}\n',
    "packages/app/src/assets/logo.svg": '<svg viewBox="0 0 6767 3000"/>\n',
  };
  for (const [path, content] of Object.entries(files)) put(root, path, content);
  git(root, "add", "-A");
  execFileSync("node", [script, "--root", root, "--apply"]);
  const read = (path) => readFileSync(join(root, path), "utf8");
  assert.match(read("packages/server/src/server/config.ts"), /= 6868/);
  assert.match(read("packages/protocol/src/ssh-transport.ts"), /= 6868/);
  assert.match(read("packages/app/src/runtime/host-runtime.ts"), /localhost:6868/);
  assert.match(read("packages/cli/src/commands/hub/local-hub.ts"), /= 6870/);
  assert.equal(read("docker/base/Dockerfile"), "EXPOSE 6868 6870\n");
  assert.match(read("scripts/dev-app.sh"), /CLISBOT_LISTEN:-127\.0\.0\.1:6869/);
  assert.equal(
    read("packages/hub/src/index.ts"),
    'const port = process.env["PORT"] ?? "6870";\nconst timeout = 3000;\n',
  );
  for (const path of [
    "docs/audits/old.md",
    "user-state/settings.json",
    "packages/app/src/assets/logo.svg",
  ]) {
    assert.equal(read(path), files[path]);
  }
  const guard = new Function("port", read("packages/app/e2e/support/helpers/daemon-port.ts"));
  for (const port of ["6767", "6768", "6868", "6869"]) assert.throws(() => guard(port), /reserved/);
  assert.doesNotThrow(() => guard("54321"));
  const check = JSON.parse(
    execFileSync("node", [script, "--root", root, "--check"], { encoding: "utf8" }),
  );
  assert.equal(check.changedFiles, 0);
});

test("rebrands source, paths, links, packages, and env names idempotently", () => {
  const root = mkdtempSync(join(tmpdir(), "clisbot-rebrand-test-"));
  git(root, "init", "-q");
  put(
    root,
    "packages/paseo-home.ts",
    'import "@getpaseo/server";\nexport const raw = env.PASEO_HOME ?? "~/.paseo";\nexport const link = "paseo://open";\n',
  );
  put(root, "packages/app/config.ts", 'export const url = "https://app.paseo.sh";\n');
  put(root, "packages/relay/config.ts", 'export const relay = "relay.paseo.sh:443";\n');
  put(
    root,
    "README.md",
    "See https://github.com/getpaseo/paseo and https://github.com/getpaseo/paseo-relay and https://paseo.sh/docs.\n",
  );
  put(root, "docs/audits/history.md", "The upstream is getpaseo/paseo.\n");
  git(root, "add", "-A");

  const args = [script, "--root", root, "--site-host", "clisbot.example"];
  const first = JSON.parse(execFileSync("node", args, { encoding: "utf8" }));
  assert.equal(first.changedFiles, 4);
  assert.equal(first.renamedPaths, 1);

  execFileSync("node", [...args, "--apply"]);
  git(root, "add", "-A");
  const second = JSON.parse(execFileSync("node", [...args, "--check"], { encoding: "utf8" }));
  assert.equal(second.changedFiles, 0);
  assert.match(readFileSync(join(root, "packages/clisbot-home.ts"), "utf8"), /CLISBOT_HOME/);
  assert.match(readFileSync(join(root, "packages/clisbot-home.ts"), "utf8"), /clisbot:\/\/open/);
  assert.match(readFileSync(join(root, "packages/clisbot-home.ts"), "utf8"), /@clisbot\/server/);
  assert.match(readFileSync(join(root, "packages/app/config.ts"), "utf8"), /app\.clisbot\.example/);
  assert.match(
    readFileSync(join(root, "packages/relay/config.ts"), "utf8"),
    /relay\.clisbot\.example/,
  );
  assert.match(readFileSync(join(root, "README.md"), "utf8"), /github\.com\/longbkit\/clisbot/);
  assert.match(readFileSync(join(root, "README.md"), "utf8"), /github\.com\/getpaseo\/paseo-relay/);
  assert.match(readFileSync(join(root, "docs/audits/history.md"), "utf8"), /getpaseo\/paseo/);
});

test("adds scoped Clisbot copyright without changing upstream legal text", () => {
  const root = mkdtempSync(join(tmpdir(), "clisbot-rebrand-license-"));
  git(root, "init", "-q");
  const upstream =
    "Copyright (c) 2025-present Mohamed Boudra\n\nPaseo and its third-party notices.\nApache License, Version 2.0\n";
  put(root, "LICENSE", upstream);
  git(root, "add", "-A");
  const args = [script, "--root", root];
  execFileSync("node", [...args, "--apply"]);
  const license = readFileSync(join(root, "LICENSE"), "utf8");
  assert.match(
    license,
    /^Clisbot modifications and original additions\nCopyright \(c\) 2026-present Long Luong/,
  );
  assert.equal(license.slice(-upstream.length), upstream);
  execFileSync("node", [...args, "--apply"]);
  assert.equal(readFileSync(join(root, "LICENSE"), "utf8"), license);
  const result = JSON.parse(execFileSync("node", [...args, "--check"], { encoding: "utf8" }));
  assert.equal(result.changedFiles, 0);

  put(
    root,
    "README.md",
    "## Plugins\n\nSetup.\n\n## License\n\nApache-2.0\n\nAdditional upstream copyright notice.\n",
  );
  git(root, "add", "-A");
  assert.throws(
    () => execFileSync("node", [...args, "--apply"], { stdio: "pipe" }),
    /Review new upstream license notices/,
  );
  assert.match(
    readFileSync(join(root, "README.md"), "utf8"),
    /Additional upstream copyright notice/,
  );
});

test("keeps live upstream services while changing public site links", () => {
  const root = mkdtempSync(join(tmpdir(), "clisbot-rebrand-hosts-"));
  git(root, "init", "-q");
  put(
    root,
    "links.md",
    "Docs https://paseo.sh/docs; web https://app.paseo.sh; relay relay.paseo.sh:443; Hub https://hub.paseo.sh; site https://www.paseo.sh; regex hub\\.paseo\\.sh and paseo\\.sh.\n",
  );
  git(root, "add", "-A");
  execFileSync("node", [script, "--root", root, "--keep-upstream-endpoints", "--apply"]);
  git(root, "add", "-A");
  const result = JSON.parse(
    execFileSync("node", [script, "--root", root, "--keep-upstream-endpoints", "--check"], {
      encoding: "utf8",
    }),
  );
  assert.equal(result.changedFiles, 0);
  assert.equal(
    readFileSync(join(root, "links.md"), "utf8"),
    "Docs https://clisbot.com/docs; web https://app.paseo.sh; relay relay.paseo.sh:443; Hub https://hub.paseo.sh; site https://www.clisbot.com; regex hub\\.paseo\\.sh and clisbot\\.com.\n",
  );
});

test("updates the desktop publishing repository", () => {
  const root = mkdtempSync(join(tmpdir(), "clisbot-rebrand-desktop-"));
  git(root, "init", "-q");
  put(
    root,
    "packages/desktop/electron-builder.yml",
    "publish:\n  owner: getpaseo\n  repo: paseo\n",
  );
  git(root, "add", "-A");
  execFileSync("node", [script, "--root", root, "--keep-upstream-endpoints", "--apply"]);
  assert.equal(
    readFileSync(join(root, "packages/desktop/electron-builder.yml"), "utf8"),
    "publish:\n  owner: longbkit\n  repo: clisbot\n",
  );
});

test("removes Paseo EAS ownership without Clisbot Expo details", () => {
  const root = mkdtempSync(join(tmpdir(), "clisbot-rebrand-expo-"));
  git(root, "init", "-q");
  put(
    root,
    "packages/app/app.config.js",
    'slug: "voice-mobile",\npackageId: "sh.paseo",\npackageId: "sh.paseo.debug",\nprojectId: "0e7f65ce-0367-46c8-a238-2b65963d235a",\nowner: "getpaseo",\n',
  );
  git(root, "add", "-A");
  execFileSync("node", [script, "--root", root, "--keep-upstream-endpoints", "--apply"]);
  git(root, "add", "-A");
  const result = JSON.parse(
    execFileSync("node", [script, "--root", root, "--keep-upstream-endpoints", "--check"], {
      encoding: "utf8",
    }),
  );
  assert.equal(result.changedFiles, 0);
  assert.equal(
    readFileSync(join(root, "packages/app/app.config.js"), "utf8"),
    'slug: "clisbot",\npackageId: "com.clisbot.app",\npackageId: "com.clisbot.app.dev",\nprojectId: process.env.CLISBOT_EXPO_PROJECT_ID,\nowner: process.env.CLISBOT_EXPO_OWNER,\n',
  );
  execFileSync("node", [
    script,
    "--root",
    root,
    "--keep-upstream-endpoints",
    "--expo-owner",
    "company",
    "--expo-project-id",
    "11111111-2222-3333-4444-555555555555",
    "--apply",
  ]);
  const configured = readFileSync(join(root, "packages/app/app.config.js"), "utf8");
  assert.match(configured, /projectId: "11111111-2222-3333-4444-555555555555"/);
  assert.match(configured, /owner: "company"/);
});

test("replaces upstream sponsorship with placeholders and uses the Clisbot community", () => {
  const root = mkdtempSync(join(tmpdir(), "clisbot-rebrand-community-"));
  git(root, "init", "-q");
  put(root, ".github/FUNDING.yml", "github: [boudra]\n");
  put(
    root,
    "README.md",
    '<h1 align="center">Paseo</h1>\n\n<p align="center">One interface for agents.</p>\n\nRun agents in parallel on your own machines. Ship from your phone or your desk.\n\n- **Multi-provider:** Claude Code, Codex, Copilot, OpenCode, and Pi through the same interface. Pick the right model for each job.\n\n<a href="https://discord.gg/jz8T2uahpH">Discord</a>\n\n## Plugins\n\nPlugin docs.\n\n## Sponsors\nSupport [Mo](https://github.com/sponsors/boudra).\n\n## Related projects\n\n- [paseo-relay](https://github.com/getpaseo/paseo-relay)\n\n## License\n\nApache-2.0\n',
  );
  put(
    root,
    "packages/app/src/components/community-links.tsx",
    'openExternalUrl("https://github.com/sponsors/boudra");\nopenExternalUrl("https://discord.gg/jz8T2uahpH");\n',
  );
  put(
    root,
    "packages/website/src/components/sponsorship.tsx",
    'const payment = "https://buy.stripe.com/upstream";\nconst github = "https://github.com/sponsors/boudra";\n',
  );
  put(root, "packages/website/src/data/sponsors.ts", 'export const SPOT_PRICE = "$500";\n');
  put(
    root,
    "packages/website/src/routes/sponsor.tsx",
    'export const description = "Sponsor via Mohamed Boudra";\n',
  );
  git(root, "add", "-A");

  const args = [script, "--root", root, "--site-host", "clisbot.example"];
  execFileSync("node", [...args, "--apply"]);
  git(root, "add", "-A");
  const result = JSON.parse(execFileSync("node", [...args, "--check"], { encoding: "utf8" }));
  assert.equal(result.changedFiles, 0);

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /discord\.gg\/awGmcmFXC/);
  assert.match(readme, /Your AI workspace and bot for work and personal life—all in one app/);
  assert.match(readme, /alternative to Grok Bot, Muse, or Dots/);
  assert.match(readme, /\*\*Freedom to choose:\*\*/);
  assert.match(readme, /40\+ agent options/);
  assert.match(readme, /38 ACP catalog presets including Grok/);
  assert.match(readme, /Antigravity as a custom ACP provider/);
  assert.match(readme, /Sponsorship options for Clisbot are being set up/);
  assert.match(readme, /## Concept\n/);
  assert.match(readme, /## Attribution\n/);
  assert.match(readme, /github\.com\/getpaseo\/paseo\)/);
  assert.match(readme, /github\.com\/openclaw\/openclaw\)/);
  assert.doesNotMatch(readme, /paseo-relay|sponsors\/boudra/);
  assert.equal(
    readFileSync(join(root, ".github/FUNDING.yml"), "utf8"),
    "# Add Clisbot funding options after sponsorship setup is ready.\n",
  );

  const appLinks = readFileSync(
    join(root, "packages/app/src/components/community-links.tsx"),
    "utf8",
  );
  assert.match(appLinks, /https:\/\/clisbot\.example\/sponsor/);
  assert.match(appLinks, /discord\.gg\/awGmcmFXC/);

  const sponsorPage = readFileSync(
    join(root, "packages/website/src/components/sponsorship.tsx"),
    "utf8",
  );
  assert.match(sponsorPage, /Sponsorship options for Clisbot are being set up/);
  assert.doesNotMatch(sponsorPage, /stripe|boudra/i);
  assert.match(
    readFileSync(join(root, "packages/website/src/data/sponsors.ts"), "utf8"),
    /HOMEPAGE_SPONSORS: ReadonlyArray<HomepageSponsor> = \[\]/,
  );
  assert.match(
    readFileSync(join(root, "packages/website/src/routes/sponsor.tsx"), "utf8"),
    /SponsorClisbotSection/,
  );
});

test("keeps the README provider count aligned with the ACP catalog", () => {
  const catalog = readFileSync(
    join(dirname(script), "../packages/app/src/data/acp-provider-catalog.ts"),
    "utf8",
  );
  const ids = [...catalog.matchAll(/^    id: "([^"]+)",/gm)].map((match) => match[1]);
  assert.equal(ids.length, 38);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("grok"));
  assert.ok(!ids.includes("antigravity"));
});

test("keeps source attribution across all README translations", () => {
  const root = mkdtempSync(join(tmpdir(), "clisbot-rebrand-readmes-"));
  git(root, "init", "-q");
  const readmes = [
    ["README.md", "Plugins", "Sponsors", "Related projects", "License", "Concept", "Attribution"],
    ["README.zh-CN.md", "快速开始", "赞助", "相关项目", "License", "项目理念", "来源与致谢"],
    [
      "README.ja.md",
      "はじめかた",
      "スポンサー",
      "関連プロジェクト",
      "ライセンス",
      "コンセプト",
      "出典と謝辞",
    ],
    ["README.ko.md", "시작하기", "스폰서", "관련 프로젝트", "라이선스", "컨셉", "출처 및 기여"],
  ];
  for (const [path, first, sponsor, related, license] of readmes) {
    const tls = path === "README.zh-CN.md" ? "\n### 自托管 relay TLS\n\nKeep this guide.\n" : "";
    put(
      root,
      path,
      `## ${first}\n\nSetup.\n\n## ${sponsor}\n\nOld sponsor.\n\n## ${related}\n\n- Old upstream links.\n${tls}\n## ${license}\n\nApache-2.0\n`,
    );
  }
  git(root, "add", "-A");

  execFileSync("node", [script, "--root", root, "--apply"]);
  git(root, "add", "-A");
  const result = JSON.parse(
    execFileSync("node", [script, "--root", root, "--check"], {
      encoding: "utf8",
    }),
  );
  assert.equal(result.changedFiles, 0);
  for (const [path, , , related, , concept, attribution] of readmes) {
    const contents = readFileSync(join(root, path), "utf8");
    assert.match(contents, new RegExp(`## ${concept}\\n`));
    assert.match(contents, new RegExp(`## ${attribution}\\n`));
    assert.match(contents, /github\.com\/getpaseo\/paseo\)/);
    assert.match(contents, /github\.com\/openclaw\/openclaw\)/);
    assert.doesNotMatch(contents, new RegExp(`## ${related}\\n`));
  }
  assert.match(readFileSync(join(root, "README.zh-CN.md"), "utf8"), /## 自托管 relay TLS/);
});

test("keeps Clisbot publication identity and archives upstream endorsements idempotently", () => {
  const root = mkdtempSync(join(tmpdir(), "clisbot-rebrand-publication-"));
  git(root, "init", "-q");
  put(root, "packages/hub/compose.yml", "image: ghcr.io/getpaseo/hub:latest\n");
  put(
    root,
    "packages/website/src/components/legal-page.tsx",
    [
      "Mohamed Boudra Ziani, operating as Paseo",
      "      NIF/VAT ID: ES26617095T",
      "      <br />",
      "      Roc Boronat 48, Bajos 2",
      "      <br />",
      "      08005 Barcelona, Spain",
      "      <br />",
      "hello@moboudra.com",
      "",
    ].join("\n"),
  );
  put(
    root,
    "packages/website/src/routes/privacy.tsx",
    "Mohamed Boudra Ziani: hello@moboudra.com\n",
  );
  put(
    root,
    "packages/website/posts/hello-world.md",
    '---\ntitle: "Hello World"\n---\nWelcome to the Paseo blog.\n',
  );
  put(
    root,
    "packages/website/src/components/landing-page.tsx",
    [
      "            <SocialProofWall />",
      "const SOCIAL_PROOF_TWEETS = [",
      '  { text: "Paseo is the best software", url: "https://x.com/example" },',
      "] as const;",
      "function AgentBadge() {}",
      "function SocialProofWall() {}",
      'const PROVIDER_ICON_CLASS = "h-5";',
      "",
    ].join("\n"),
  );
  git(root, "add", "-A");
  const args = [script, "--root", root, "--keep-upstream-endpoints"];
  execFileSync("node", [...args, "--apply"]);
  git(root, "add", "-A");
  assert.equal(
    JSON.parse(execFileSync("node", [...args, "--check"], { encoding: "utf8" })).changedFiles,
    0,
  );
  assert.match(
    readFileSync(join(root, "packages/hub/compose.yml"), "utf8"),
    /ghcr\.io\/longbkit\/clisbot:latest/,
  );
  const legal = readFileSync(join(root, "packages/website/src/components/legal-page.tsx"), "utf8");
  assert.match(legal, /Long Luong, operating as Clisbot/);
  assert.match(legal, /clisbot@gmail\.com/);
  assert.doesNotMatch(legal, /Boudra|ES26617095T|Barcelona|Roc Boronat/);
  const landing = readFileSync(
    join(root, "packages/website/src/components/landing-page.tsx"),
    "utf8",
  );
  assert.doesNotMatch(landing, /SocialProof|SOCIAL_PROOF|best software|x\.com/);
  assert.match(landing, /function AgentBadge/);
  const archived = readFileSync(
    join(root, "packages/website/posts/upstream/hello-world.md"),
    "utf8",
  );
  assert.match(archived, /Mo Boudra about Paseo/);
  assert.match(archived, /Welcome to the Paseo blog/);
});

test("stops on unfamiliar testimonial markup before applying any rename", () => {
  const root = mkdtempSync(join(tmpdir(), "clisbot-rebrand-editorial-"));
  git(root, "init", "-q");
  put(root, "packages/example.ts", 'const brand = "Paseo";\n');
  put(
    root,
    "packages/website/src/components/landing-page.tsx",
    "const SOCIAL_PROOF_TWEETS = newerLayout();\n",
  );
  git(root, "add", "-A");
  assert.throws(
    () => execFileSync("node", [script, "--root", root, "--apply"], { stdio: "pipe" }),
    /Review upstream publication block/,
  );
  assert.match(readFileSync(join(root, "packages/example.ts"), "utf8"), /Paseo/);
});

function git(root, ...args) {
  execFileSync("git", args, { cwd: root });
}

function put(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
