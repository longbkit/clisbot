#!/usr/bin/env node

// Rebrand a Git checkout without depending on scripts inside that checkout.
// This file lives on the Fusion branch and is also invoked against raw upstream worktrees.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { publicationPath, rebrandPublication } from "./rebrand-templates/publication.mjs";

const options = parseArgs(process.argv.slice(2));
const root = resolve(options.root);
const siteHost = options.siteHost;
const appHost = options.keepUpstreamEndpoints ? null : (options.appHost ?? `app.${siteHost}`);
const relayHost = options.keepUpstreamEndpoints ? null : (options.relayHost ?? `relay.${siteHost}`);
const repoSlug = options.repoSlug;
const decoder = new TextDecoder("utf-8", { fatal: true });
const templateRoot = join(dirname(fileURLToPath(import.meta.url)), "rebrand-templates");
const productTemplates = new Map(
  [
    ["packages/website/src/components/sponsorship.tsx", "website-sponsorship.tsx"],
    ["packages/website/src/data/sponsors.ts", "website-sponsors.ts"],
    ["packages/website/src/routes/sponsor.tsx", "website-sponsor-route.tsx"],
  ].map(([path, template]) => [path, readFileSync(join(templateRoot, template), "utf8")]),
);
const readmeSections = new Map([
  [
    "README.md",
    {
      locale: "en",
      tagline: "Your AI workspace and bot for work and personal life—all in one app.",
      subtitle: "Work and chat with AI natively in Clisbot and across your communication channels.",
      previousWorkspaceIntro:
        "Work with AI in a desktop workspace for office work and software engineering. Bring conversations, files, documents, and code together—from research and analysis to planning, implementation, testing, and review.",
      previousCoworkIntro:
        "Your AI coworker for office work and software engineering—from documents, research, and analysis to planning, coding, testing, and code review.",
      previousBotIntro:
        "Create your own AI bot for work and life—an alternative to Grok Bot, Muse, or Dots that you control and customize. Set its persona, memory, tools, agent provider, model, and where it runs. Reach Clisbot from your laptop, phone, or supported chat channels.",
      previousIntro:
        "Run agents in parallel on your own machines. Ship from your phone or your desk.",
      intermediateIntro:
        "Your AI coworker for projects and a personal bot for everyday life. Bring Clisbot into the chat apps and conversation channels you use, from your laptop or on the go.",
      previousProviderBullet:
        "- **Multi-provider:** Claude Code, Codex, Copilot, OpenCode, and Pi through the same interface. Pick the right model for each job.",
      intermediateProviderBullet:
        "- **Freedom to choose:** Pick Claude Code, Codex, Copilot, OpenCode, or Pi for each task, along with the model. Switch agent providers as your work evolves.",
      providerBullet:
        "- **Freedom to choose:** 40+ agent options: Claude Code, Codex, Copilot, OpenCode, and Pi are built in; explore 38 ACP catalog presets including Grok, or add Antigravity as a custom ACP provider. Pick the model for each task.",
      sponsorHeading: "Sponsors",
      sponsorMessage:
        "Sponsorship options for Clisbot are being set up. Check back here when they are ready.",
      relatedHeading: "Related projects",
      conceptHeading: "Concept",
      authorHeading: "Who am I & Why I Built This",
      conceptBefore: "Plugins",
      attributionHeading: "Attribution",
      licenseHeading: "License",
    },
  ],
  [
    "README.zh-CN.md",
    {
      locale: "zh",
      tagline: "用于工作与个人生活的 AI 工作空间和 Bot，尽在一个应用。",
      subtitle: "在 Clisbot 内原生地与 AI 工作、聊天，也能通过常用的沟通渠道与 AI 互动。",
      previousWorkspaceIntro:
        "在桌面工作空间中与 AI 一起完成办公和软件工程工作。将对话、文件、文档和代码汇集一处，覆盖研究、分析、规划、实现、测试和审查。",
      previousCoworkIntro:
        "你的办公与软件工程 AI 同事：从文档、研究和分析，到规划、编程、测试和代码审查，都能与你协作。",
      previousBotIntro:
        "创建自己的工作与生活 AI Bot：一个可由你掌控和定制的 Grok Bot、Muse 或 Dots 替代选择。你可以设置它的角色、记忆、工具、Agent 提供商、模型和运行位置，并通过笔记本电脑、手机或受支持的聊天渠道使用 Clisbot。",
      previousIntro: "在你自己的机器上并行运行 agents。无论在手机上还是桌前，都能推进交付。",
      intermediateIntro:
        "Clisbot 可以是项目中的 AI 同事，也可以是日常生活中的个人 Bot。把它带进常用的聊天应用和对话渠道，无论在笔记本电脑前还是出门在外都能使用。",
      previousProviderBullet:
        "- **多提供商：** 通过同一个界面使用 Claude Code、Codex、Copilot、OpenCode 和 Pi。为每个任务选择合适的模型。",
      intermediateProviderBullet:
        "- **自由选择 Agent：** 根据任务选择 Claude Code、Codex、Copilot、OpenCode 或 Pi，并选用合适的模型。工作方式变化时，也可以切换 Agent 提供商。",
      providerBullet:
        "- **自由选择 Agent：** 提供 40 多种 Agent 选项：内置 Claude Code、Codex、Copilot、OpenCode 和 Pi 的集成，ACP 目录另有 38 个预设（包括 Grok）；也可以通过自定义 ACP 配置接入 Antigravity。为每个任务选择合适的模型。",
      sponsorHeading: "赞助",
      sponsorMessage: "Clisbot 的赞助方式正在准备中。设置完成后，我们会在此更新。",
      relatedHeading: "相关项目",
      conceptHeading: "项目理念",
      authorHeading: "我是谁，为什么开发这个项目",
      conceptBefore: "快速开始",
      attributionHeading: "来源与致谢",
      licenseHeading: "License",
    },
  ],
  [
    "README.ja.md",
    {
      locale: "ja",
      tagline: "仕事と私生活のための AI ワークスペースと Bot を、ひとつのアプリに。",
      subtitle:
        "Clisbot に組み込まれた AI と仕事やチャットを。普段のコミュニケーションチャネルからも利用できます。",
      previousWorkspaceIntro:
        "デスクトップのワークスペースで、AI とオフィス業務やソフトウェアエンジニアリングを進められます。会話、ファイル、文書、コードを一か所にまとめ、調査・分析から計画・実装・テスト・レビューまで取り組めます。",
      previousCoworkIntro:
        "オフィス業務とソフトウェアエンジニアリングをともに進める AI の同僚。文書作成、調査、分析から、計画、コーディング、テスト、コードレビューまで、一緒に取り組めます。",
      previousBotIntro:
        "仕事にも日常にも使える、自分だけの AI Bot を作れます。Grok Bot、Muse、Dots に代わる選択肢として、ペルソナ、記憶、ツール、エージェントプロバイダー、モデル、実行場所を自分で管理・カスタマイズできます。Clisbot はノート PC、スマートフォン、対応するチャットチャネルから利用できます。",
      previousIntro:
        "自分のマシンでエージェントを並列実行。スマートフォンからでもデスクからでも、開発を進めてリリースできます。",
      intermediateIntro:
        "Clisbot はプロジェクトを進める AI の同僚にも、日常を支えるパーソナル Bot にもなります。普段使うチャットアプリや会話チャネルにつなぎ、ノート PC でも外出先でも利用できます。",
      previousProviderBullet:
        "- **マルチプロバイダー:** Claude Code、Codex、Copilot、OpenCode、Pi を同一のインターフェースで利用。タスクに合ったモデルを選べます。",
      intermediateProviderBullet:
        "- **エージェントを自由に選択:** タスクに合わせて Claude Code、Codex、Copilot、OpenCode、Pi とモデルを選べます。仕事の変化に応じてプロバイダーを切り替えられます。",
      providerBullet:
        "- **エージェントを自由に選択:** 40 種類以上の選択肢。Claude Code、Codex、Copilot、OpenCode、Pi の標準対応に加え、Grok を含む 38 件の ACP カタログプリセットを利用できます。Antigravity はカスタム ACP 設定で追加でき、タスクごとにモデルも選べます。",
      sponsorHeading: "スポンサー",
      sponsorMessage:
        "Clisbot のスポンサー向け情報は準備中です。準備ができ次第、ここに掲載します。",
      relatedHeading: "関連プロジェクト",
      conceptHeading: "コンセプト",
      authorHeading: "私について、このプロジェクトを作った理由",
      conceptBefore: "はじめかた",
      attributionHeading: "出典と謝辞",
      licenseHeading: "ライセンス",
    },
  ],
  [
    "README.ko.md",
    {
      locale: "ko",
      tagline: "업무와 개인 생활을 위한 AI 작업 공간과 봇을 하나의 앱에서.",
      subtitle:
        "Clisbot에 내장된 AI와 일하고 대화하세요. 평소 사용하는 소통 채널에서도 AI를 이용할 수 있습니다.",
      previousWorkspaceIntro:
        "데스크톱 작업 공간에서 AI와 함께 사무 업무와 소프트웨어 엔지니어링을 진행하세요. 대화, 파일, 문서, 코드를 한곳에 모아 조사와 분석부터 계획, 구현, 테스트, 리뷰까지 이어갈 수 있습니다.",
      previousCoworkIntro:
        "사무 업무와 소프트웨어 엔지니어링을 함께하는 AI 동료입니다. 문서 작성, 조사, 분석부터 계획, 코딩, 테스트, 코드 리뷰까지 함께할 수 있습니다.",
      previousBotIntro:
        "일과 일상에 사용할 나만의 AI 봇을 만드세요. Grok Bot, Muse, Dots의 대안으로 페르소나, 메모리, 도구, 에이전트 제공자, 모델, 실행 위치를 직접 제어하고 맞춤 설정할 수 있습니다. Clisbot를 노트북, 휴대폰, 지원되는 채팅 채널에서 사용하세요.",
      previousIntro:
        "내 컴퓨터에서 에이전트를 병렬로 실행하세요. 데스크톱이나 휴대폰에서 배포하세요.",
      intermediateIntro:
        "Clisbot는 프로젝트를 함께하는 AI 동료이자 일상을 돕는 개인용 봇입니다. 자주 쓰는 채팅 앱과 대화 채널에 연결해 노트북 앞에서도 이동 중에도 사용할 수 있습니다.",
      previousProviderBullet:
        "- **여러 제공자 지원:** Claude Code, Codex, Copilot, OpenCode, Pi를 하나의 인터페이스에서 사용할 수 있습니다. 작업마다 알맞은 모델을 고를 수 있습니다.",
      intermediateProviderBullet:
        "- **에이전트 선택의 자유:** 작업마다 Claude Code, Codex, Copilot, OpenCode, Pi와 적합한 모델을 선택할 수 있습니다. 필요에 따라 에이전트 제공자를 바꿀 수 있습니다.",
      providerBullet:
        "- **에이전트 선택의 자유:** 40개가 넘는 에이전트 옵션을 제공합니다. 기본 지원하는 Claude Code, Codex, Copilot, OpenCode, Pi에 더해 Grok을 포함한 ACP 카탈로그 프리셋 38개를 이용할 수 있습니다. Antigravity는 사용자 지정 ACP 설정으로 추가하고, 작업마다 모델을 선택하세요.",
      sponsorHeading: "스폰서",
      sponsorMessage:
        "Clisbot 후원 안내를 준비 중입니다. 준비가 완료되면 이곳에 업데이트하겠습니다.",
      relatedHeading: "관련 프로젝트",
      conceptHeading: "컨셉",
      authorHeading: "저는 누구이며, 왜 이 프로젝트를 만들었나요",
      conceptBefore: "시작하기",
      attributionHeading: "출처 및 기여",
      licenseHeading: "라이선스",
    },
  ],
]);

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

const planned = [];
const destinationOwners = new Map();
const changedByTopLevel = new Map();
const skippedBinary = [];
const missing = [];

for (const path of tracked) {
  const source = join(root, path);
  if (!existsSync(source)) {
    missing.push(path);
    continue;
  }
  const protectedPath = isProtectedPath(path);
  const target = protectedPath ? path : renameProductText(publicationPath(path));
  const prior = destinationOwners.get(target);
  if (prior && prior !== path) {
    throw new Error(`Path collision: ${prior} and ${path} both map to ${target}`);
  }
  destinationOwners.set(target, path);

  const stat = lstatSync(source);
  let before = null;
  let after = null;
  let occurrences = 0;
  if ((!protectedPath || path === "LICENSE") && stat.isFile()) {
    const bytes = readFileSync(source);
    if (bytes.includes(0)) {
      skippedBinary.push(path);
    } else {
      before = decodeText(bytes, path);
      if (before !== null) {
        after =
          path === "LICENSE"
            ? addClisbotLicenseNotice(before)
            : rebrandPublication(
                path,
                productTemplates.get(path) ??
                  removeCollapsedAliases(path, renameProductText(before)),
                { repoSlug },
              );
        occurrences = countBrandTokens(before);
      }
    }
  }

  if (target !== path || (after !== null && after !== before)) {
    planned.push({ path, target, after, occurrences });
    const top = path.split("/")[0];
    changedByTopLevel.set(top, (changedByTopLevel.get(top) ?? 0) + 1);
  }
}

if (missing.length) {
  throw new Error(
    `${missing.length} tracked paths are missing. Stage an earlier rename with git add -A before running the check again. First: ${missing[0]}`,
  );
}

for (const item of planned) {
  const target = join(root, item.target);
  if (item.target !== item.path && existsSync(target) && !tracked.includes(item.target)) {
    throw new Error(`Destination already exists outside the Git index: ${item.target}`);
  }
}

if (options.mode === "apply") {
  for (const item of planned) {
    const source = join(root, item.path);
    if (item.after !== null) writeFileSync(source, item.after);
    if (item.target !== item.path) {
      const target = join(root, item.target);
      mkdirSync(dirname(target), { recursive: true });
      renameSync(source, target);
      removeEmptyParents(dirname(source));
    }
  }
  const renamedTargets = planned
    .filter((item) => item.path !== item.target)
    .map((item) => item.target);
  if (renamedTargets.length) {
    let ignored = "";
    try {
      ignored = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], {
        cwd: root,
        input: renamedTargets.join("\n") + "\n",
        encoding: "utf8",
      }).trim();
    } catch (error) {
      if (error.status !== 1) throw error;
    }
    if (ignored) {
      throw new Error(
        `Rename applied, but Git ignores these renamed source files:\n${ignored}\n` +
          "Add scoped .gitignore exceptions or stage these exact paths with git add -f before committing. " +
          "Do not force-add the entire checkout.",
      );
    }
  }
}

const report = {
  mode: options.mode,
  root,
  changedFiles: planned.length,
  renamedPaths: planned.filter((item) => item.path !== item.target).length,
  oldBrandOccurrencesInChangedFiles: planned.reduce((sum, item) => sum + item.occurrences, 0),
  changedFilesByTopLevel: Object.fromEntries([...changedByTopLevel].sort()),
  skippedBinaryFiles: skippedBinary.length,
  replacements: {
    siteHost,
    appHost,
    relayHost,
    repoSlug,
    expoOwner: options.expoOwner ?? "CLISBOT_EXPO_OWNER env required for EAS",
    expoProjectId: options.expoProjectId ?? "CLISBOT_EXPO_PROJECT_ID env required for EAS",
  },
};
console.log(JSON.stringify(report, null, 2));
if (options.mode === "check" && planned.length) process.exitCode = 1;

function isProtectedPath(path) {
  return (
    path === "scripts/rebrand-clisbot.mjs" ||
    path === "scripts/rebrand-clisbot.test.mjs" ||
    path.startsWith("scripts/branding/") ||
    path.startsWith("assets/branding/") ||
    path.startsWith("scripts/rebrand-templates/") ||
    path.startsWith("packages/website/posts/upstream/") ||
    path === "LICENSE" ||
    path.startsWith("docs/audits/") ||
    path.startsWith("docs/lessons/") ||
    path === "docs/overview/product-vision.md" ||
    path === "docs/guides/developer-guide/upstream-sync-and-contribution.md"
  );
}

function renameProductText(input) {
  const retainedHosts = [];
  const retainedRepos = [];
  // URL matchers and login return URLs encode separators; also repair the
  // partially renamed form produced by older revisions of this transform.
  const repositoryUrls = input.replace(
    /getpaseo(\\\/|%2[fF])(?:paseo|clisbot)(?=\\\/|%2[fF])/g,
    (_match, separator) => repoSlug.replaceAll("/", separator),
  );
  const withExternalRepos = repositoryUrls.replace(
    /getpaseo(?:\/|\\\/|%2[fF])paseo-relay\b/g,
    (repo) => {
      const index = retainedRepos.push(repo) - 1;
      return `__CLISBOT_UPSTREAM_REPO_${index}__`;
    },
  );
  const prepared = options.keepUpstreamEndpoints
    ? withExternalRepos.replace(/(?:relay|app|hub)\.paseo\.sh/g, (host) => {
        const index = retainedHosts.push(host) - 1;
        return `__CLISBOT_UPSTREAM_HOST_${index}__`;
      })
    : withExternalRepos;
  const renamed = prepared
    .replaceAll("jz8T2uahpH", "awGmcmFXC")
    .replaceAll("https://github.com/sponsors/boudra", `https://${siteHost}/sponsor`)
    .replaceAll("@getpaseo", "@clisbot")
    .replace(/getpaseo\/paseo(?![\w-])/g, repoSlug)
    .replaceAll("relay.paseo.sh", relayHost ?? "relay.paseo.sh")
    .replaceAll("app.paseo.sh", appHost ?? "app.paseo.sh")
    .replaceAll("paseo.sh", siteHost ?? "paseo.sh")
    .replaceAll("PASEO", "CLISBOT")
    .replaceAll("Paseo", "Clisbot")
    .replace(/(?<!get)paseo/g, "clisbot");
  // Regex literals escape the dots in hosts; ordinary URL replacement cannot see them.
  const escapedSite = siteHost.replaceAll(".", "\\.");
  let fixedEscapedHosts = renamed.replaceAll("clisbot\\.sh", escapedSite);
  if (options.keepUpstreamEndpoints) {
    for (const service of ["app", "relay", "hub"]) {
      fixedEscapedHosts = fixedEscapedHosts.replaceAll(
        `${service}\\.${escapedSite}`,
        `${service}\\.paseo\\.sh`,
      );
    }
  }
  return fixedEscapedHosts
    .replace(/__CLISBOT_UPSTREAM_HOST_(\d+)__/g, (_, index) => retainedHosts[Number(index)])
    .replace(/__CLISBOT_UPSTREAM_REPO_(\d+)__/g, (_, index) => retainedRepos[Number(index)]);
}

// The current Fusion tree deliberately supports both the upstream and Clisbot
// environment names. A full rename maps those two names to the same key. Remove
// the resulting duplicate code; raw upstream snapshots simply lack these seams.
function removeCollapsedAliases(path, input) {
  if (path === ".github/FUNDING.yml") {
    return "# Add Clisbot funding options after sponsorship setup is ready.\n";
  }
  if (readmeSections.has(path)) {
    const config = readmeSections.get(path);
    const cleaned = replaceReadmeIntro(path, config, replaceReadmeSponsorSection(path, input))
      .replace(/  <a href="https:\/\/x\.com\/moboudra">[\s\S]*?  <\/a>\n/g, "")
      .replace(/  <a href="https:\/\/www\.reddit\.com\/r\/ClisbotAI\/">[\s\S]*?  <\/a>\n/g, "")
      .replace(
        "> 如果问题很紧急或阻塞了你，[Discord](https://discord.gg/awGmcmFXC) 是最快联系到我的地方。",
        "> 有问题或想参与社区讨论，请加入 [Clisbot Discord](https://discord.gg/awGmcmFXC)。",
      )
      .replace(
        "> 急ぎの問題や作業がブロックされている場合は、[Discord](https://discord.gg/awGmcmFXC) から連絡するのが一番早いです。",
        "> 質問やコミュニティでの交流は、[Clisbot Discord](https://discord.gg/awGmcmFXC) に参加してください。",
      )
      .replace(
        "> 我是独立维护者，不一定每天都能及时处理 GitHub Issues。",
        "> GitHub Issues 用于报告 bug；其他问题请到社区讨论。",
      )
      .replace(
        "> 私はひとりでメンテナンスしているため、GitHub Issues を毎日確認できるとは限りません。",
        "> GitHub Issues はバグ報告に利用してください。その他の質問はコミュニティへどうぞ。",
      )
      .replace(
        "I use this to plan with Claude and then handoff to Codex to implement.",
        "Plan with Claude, then hand off implementation to Codex.",
      )
      .replace(
        "我会用它先和 Claude 规划，再交给 Codex 实现。",
        "例如，先由 Claude 规划，再交给 Codex 实现。",
      )
      .replace(
        "私はこれを使って Claude で計画し、Codex に実装を引き継いでいます。",
        "たとえば Claude で計画し、実装を Codex に引き継げます。",
      )
      .replace("対照的な2つのエージェント", "対照的な 2 つのエージェント");
    const withoutRelated = removeReadmeRelatedProjects(path, config, cleaned);
    const withConcept = upsertReadmeSection(
      path,
      withoutRelated,
      config.conceptHeading,
      config.conceptBefore,
      readFileSync(join(templateRoot, `readme-${config.locale}-concept.md`), "utf8"),
    );
    const withAuthor = upsertReadmeSection(
      path,
      withConcept,
      config.authorHeading,
      config.conceptBefore,
      readFileSync(join(templateRoot, `readme-${config.locale}-author.md`), "utf8"),
    );
    const withAttribution = upsertReadmeSection(
      path,
      withAuthor,
      config.attributionHeading,
      config.licenseHeading,
      readFileSync(join(templateRoot, `readme-${config.locale}-attribution.md`), "utf8"),
    );
    return replaceReadmeLicense(path, config, withAttribution);
  }
  if (path === ".github/ISSUE_TEMPLATE/bug-report.yml") {
    return input.replace(
      "or `#product` in [Discord](https://discord.gg/awGmcmFXC)",
      "or [Clisbot Discord](https://discord.gg/awGmcmFXC)",
    );
  }
  if (path === "packages/website/src/components/site-footer.tsx") {
    return input.replace(
      /\s*<a\n\s*href="https:\/\/www\.reddit\.com\/r\/ClisbotAI\/"[\s\S]*?<\/a>/,
      "",
    );
  }
  if (path === "packages/desktop/electron-builder.yml") {
    return input.replace(
      "  owner: getpaseo\n  repo: clisbot",
      "  owner: longbkit\n  repo: clisbot",
    );
  }
  if (path === "packages/app/app.config.js") {
    const owner = options.expoOwner
      ? JSON.stringify(options.expoOwner)
      : "process.env.CLISBOT_EXPO_OWNER";
    const projectId = options.expoProjectId
      ? JSON.stringify(options.expoProjectId)
      : "process.env.CLISBOT_EXPO_PROJECT_ID";
    return input
      .replace('slug: "voice-mobile"', 'slug: "clisbot"')
      .replace('packageId: "sh.clisbot"', 'packageId: "com.clisbot.app"')
      .replace('packageId: "sh.clisbot.debug"', 'packageId: "com.clisbot.app.dev"')
      .replace(
        /projectId: (?:"[0-9a-f-]{36}"|process\.env\.CLISBOT_EXPO_PROJECT_ID)/,
        `projectId: ${projectId}`,
      )
      .replace(/owner: (?:"getpaseo"|process\.env\.CLISBOT_EXPO_OWNER)/, `owner: ${owner}`);
  }
  if (path === "packages/server/CLAUDE.md") {
    return input.replace(
      /(\$CLISBOT_HOME\/agents\/\{cwd-with-dashes\}\/\{agent-id\}\.json`)  \n/,
      "$1\n",
    );
  }
  if (path === "packages/cli/src/commands/bot/owner-bootstrap.ts") {
    return input.replace(
      /    CLISBOT_BOOTSTRAP_ORGANIZATION: options\.organizationName \?\? "Clisbot",\n    CLISBOT_BOOTSTRAP_OWNER_EMAIL: options\.ownerEmail,\n    CLISBOT_BOOTSTRAP_OWNER_PASSWORD: password,\n(?=    CLISBOT_BOOTSTRAP_ORGANIZATION:)/,
      "",
    );
  }
  if (path === "packages/cli/src/commands/hub/local-hub.ts") {
    return input
      .replace(
        "    env.CLISBOT_HOME?.trim() ||\n    env.CLISBOT_HOME?.trim() ||\n",
        "    env.CLISBOT_HOME?.trim() ||\n",
      )
      .replace("    CLISBOT_HOME: home,\n  };", "  };");
  }
  if (path === "packages/cli/src/commands/hub/local-hub.test.ts") {
    return input
      .replace(
        "flag beats CLISBOT_HOME, CLISBOT_HOME, and default",
        "flag beats CLISBOT_HOME and default",
      )
      .replace(
        'const env = { CLISBOT_HOME: "/a", CLISBOT_HOME: "/b" }',
        'const env = { CLISBOT_HOME: "/a" }',
      )
      .replace(
        '    expect(resolveLocalHubHome({}, { CLISBOT_HOME: "/b" } as NodeJS.ProcessEnv)).toBe("/b");\n',
        "",
      );
  }
  if (path === "packages/hub/src/env-alias.ts") {
    return input.replace(/^  \["(CLISBOT_[A-Z_]+)", "\1"\],\n/gm, "");
  }
  if (path === "packages/hub/src/env-alias.test.ts") {
    return input
      .replace(
        /  it\("lets an explicit CLISBOT value win over the CLISBOT alias", \(\) => \{[\s\S]*?\n  \}\);\n\n/,
        "",
      )
      .replace(
        "copies a set CLISBOT var into its internal target when unset",
        "preserves an explicit Clisbot home",
      )
      .replace(
        "aliases the channel kill switch and bind vars",
        "preserves the channel kill switch and bind vars",
      );
  }
  if (path === "packages/hub/src/channels/loader/channel-gate.test.ts") {
    return input.replace(
      /  it\("reads the internal \(non-alias\) env name", \(\) => \{[\s\S]*?\n  \}\);\n/,
      "",
    );
  }
  return input;
}

function replaceReadmeSponsorSection(path, input) {
  const { sponsorHeading, sponsorMessage } = readmeSections.get(path);
  const start = `## ${sponsorHeading}\n`;
  const first = input.indexOf(start);
  if (first < 0) return input;
  const last = input.indexOf("\n## ", first + start.length);
  if (last < 0) throw new Error(`Cannot find the end of the sponsor section in ${path}`);
  return (
    input.slice(0, first) +
    `${start}\n${sponsorMessage}\n\n<!-- Sponsor logos go here, in the same order as packages/website/src/data/sponsors.ts -->\n` +
    input.slice(last)
  );
}

function replaceReadmeIntro(path, config, input) {
  if (!input.includes('<h1 align="center">Clisbot</h1>')) return input;
  const taglinePattern = /<p align="center">[^<\n]+<\/p>(?:\n\n<p align="center">[^<\n]+<\/p>)?/;
  if (!taglinePattern.test(input)) throw new Error(`Cannot find the tagline in ${path}`);
  const withTagline = input.replace(
    taglinePattern,
    `<p align="center">${config.tagline}</p>\n\n<p align="center">${config.subtitle}</p>`,
  );
  const withProviderChoice = [
    config.previousProviderBullet,
    config.intermediateProviderBullet,
  ].reduce((body, previous) => body.replace(previous, config.providerBullet), withTagline);
  if (!withProviderChoice.includes(config.providerBullet)) {
    throw new Error(`Cannot find the provider choice bullet in ${path}`);
  }
  const introBody = readFileSync(
    join(templateRoot, `readme-${config.locale}-intro.md`),
    "utf8",
  ).trim();
  const introStart = "<!-- clisbot:intro:start -->";
  const introEnd = "<!-- clisbot:intro:end -->";
  const intro = `${introStart}\n\n${introBody}\n\n${introEnd}`;
  if (withProviderChoice.includes(intro)) return withProviderChoice;
  const start = withProviderChoice.indexOf(introStart);
  if (start >= 0) {
    const end = withProviderChoice.indexOf(introEnd, start + introStart.length);
    if (end < 0) {
      throw new Error(`Cannot find the end of the Clisbot introduction in ${path}`);
    }
    return (
      withProviderChoice.slice(0, start) + intro + withProviderChoice.slice(end + introEnd.length)
    );
  }
  const previousIntro = [
    `${config.previousWorkspaceIntro}\n\n${config.previousBotIntro}`,
    `${config.previousCoworkIntro}\n\n${config.previousBotIntro}`,
    config.previousIntro,
    config.intermediateIntro,
    config.previousBotIntro,
  ].find((previous) => withProviderChoice.includes(previous));
  if (!previousIntro) {
    throw new Error(`Cannot find the introductory description in ${path}`);
  }
  return withProviderChoice.replace(previousIntro, intro);
}

function removeReadmeRelatedProjects(path, config, input) {
  const heading = `## ${config.relatedHeading}\n`;
  const first = input.indexOf(heading);
  if (first < 0) {
    return config.locale === "zh" ? input.replace(/(## 自托管 relay TLS\n)(?!\n)/, "$1\n") : input;
  }
  const last = input.indexOf("\n## ", first + heading.length);
  if (last < 0) throw new Error(`Cannot find the end of related projects in ${path}`);
  const section = input.slice(first, last);
  let replacement = "";
  if (config.locale === "zh") {
    const tlsHeading = "\n### 自托管 relay TLS\n";
    const tlsStart = section.indexOf(tlsHeading);
    if (tlsStart >= 0) {
      replacement = `## 自托管 relay TLS\n\n${section
        .slice(tlsStart + tlsHeading.length)
        .trim()}\n\n`;
    }
  }
  return input.slice(0, first) + replacement + input.slice(last + 1);
}

function upsertReadmeSection(path, input, heading, beforeHeading, body) {
  const start = `## ${heading}\n`;
  const existing = input.indexOf(start);
  if (existing >= 0) {
    const next = input.indexOf("\n## ", existing + start.length);
    if (next < 0) throw new Error(`Cannot find the end of ${heading} in ${path}`);
    input = input.slice(0, existing) + input.slice(next + 1);
  }
  const anchor = `## ${beforeHeading}\n`;
  const before = input.indexOf(anchor);
  if (before < 0) {
    if (input.includes("## ")) throw new Error(`Cannot find ${beforeHeading} in ${path}`);
    return input;
  }
  return input.slice(0, before) + `${start}\n${body.trim()}\n\n` + input.slice(before);
}

function addClisbotLicenseNotice(input) {
  const prefix = `${readFileSync(
    join(templateRoot, "license-clisbot-notice.txt"),
    "utf8",
  ).trimEnd()}\n\n`;
  if (input.startsWith(prefix)) return input;
  if (input.includes("Clisbot modifications and original additions")) {
    throw new Error("Review the existing Clisbot copyright notice in LICENSE before updating it");
  }
  // Keep the entire upstream notice and license verbatim after our scoped notice.
  return prefix + input;
}

function replaceReadmeLicense(path, config, input) {
  const heading = `## ${config.licenseHeading}\n`;
  const start = input.indexOf(heading);
  if (start < 0) return input;
  const next = input.indexOf("\n## ", start + heading.length);
  const end = next < 0 ? input.length : next;
  const current = input.slice(start + heading.length, end).trim();
  const body = readFileSync(
    join(templateRoot, `readme-${config.locale}-license.md`),
    "utf8",
  ).trim();
  if (current !== "Apache-2.0" && current !== body && current !== renameProductText(body)) {
    throw new Error(`Review new upstream license notices in ${path} before replacing this section`);
  }
  return input.slice(0, start) + `${heading}\n${body}\n` + input.slice(end);
}

function countBrandTokens(input) {
  return (input.match(/PASEO|Paseo|paseo/g) ?? []).length;
}

function decodeText(bytes, path) {
  try {
    return decoder.decode(bytes);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    skippedBinary.push(path);
    return null;
  }
}

function removeEmptyParents(start) {
  let current = start;
  while (current !== root && current.startsWith(`${root}${sep}`)) {
    try {
      rmdirSync(current);
    } catch {
      break;
    }
    current = dirname(current);
  }
}

function parseArgs(args) {
  const result = {
    mode: "report",
    root: process.cwd(),
    repoSlug: "longbkit/clisbot",
    siteHost: "clisbot.com",
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--apply" || arg === "--check") result.mode = arg.slice(2);
    else if (arg === "--root") result.root = args[++i];
    else if (arg === "--site-host") result.siteHost = args[++i];
    else if (arg === "--app-host") result.appHost = args[++i];
    else if (arg === "--relay-host") result.relayHost = args[++i];
    else if (arg === "--repo-slug") result.repoSlug = args[++i];
    else if (arg === "--expo-owner") result.expoOwner = args[++i];
    else if (arg === "--expo-project-id") result.expoProjectId = args[++i];
    else if (arg === "--keep-upstream-endpoints") result.keepUpstreamEndpoints = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!result.siteHost || result.siteHost.includes("/")) {
    throw new Error("--site-host must be a hostname");
  }
  if (result.keepUpstreamEndpoints && (result.appHost || result.relayHost)) {
    throw new Error("--keep-upstream-endpoints cannot be combined with service hosts");
  }
  if (Boolean(result.expoOwner) !== Boolean(result.expoProjectId)) {
    throw new Error(
      "Pass both --expo-owner and --expo-project-id, or neither for local-only testing",
    );
  }
  if (
    result.expoProjectId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.expoProjectId)
  ) {
    throw new Error("--expo-project-id must be a UUID");
  }
  return result;
}
