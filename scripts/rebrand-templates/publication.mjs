// Product identity and inherited editorial material need contextual transforms.
// Keep this module outside the general text replacement, like the README templates.
import { rebrandPorts } from "./ports.mjs";
import { rebrandHubDocs } from "./hub-docs.mjs";
const upstreamPost = /^(?:hello-world|i-was-wrong-about-electron)(?:\.[A-Za-z0-9-]+)?\.md$/;
const postsRoot = "packages/website/posts/";
const hostedHubDoc = /^public-docs\/hub\/hosted(?:\.[A-Za-z0-9-]+)?\.md$/;

// Reviewed v0.13.0 translations describe upstream contracts, not these fork-owned guides.
// Exact zh-CN paths only: new pages/locales still require individual publication review.
const divergentChineseDocs = new Set([
  "public-docs/index.zh-CN.md",
  "public-docs/connectivity.zh-CN.md",
  "public-docs/docker.zh-CN.md",
  "public-docs/web-ui.zh-CN.md",
  "public-docs/cli.zh-CN.md",
  "public-docs/hub/index.zh-CN.md",
  "public-docs/hub/quickstart.zh-CN.md",
  "public-docs/hub/concepts.zh-CN.md",
  "public-docs/hub/daemons.zh-CN.md",
  "public-docs/hub/triggers/github.zh-CN.md",
  "public-docs/hub/configuration/index.zh-CN.md",
  "public-docs/hub/configuration/hub-yml.zh-CN.md",
  "public-docs/hub/activity.zh-CN.md",
  "public-docs/hub/faq.zh-CN.md",
  "public-docs/hub/security.zh-CN.md",
]);

export function publicationPath(path) {
  if (hostedHubDoc.test(path) || divergentChineseDocs.has(path)) {
    return `docs/audits/upstream-public-docs/${path.slice("public-docs/".length)}`;
  }
  const name = path.slice(postsRoot.length);
  return path.startsWith(postsRoot) && upstreamPost.test(name)
    ? `${postsRoot}upstream/${name}`
    : path;
}

export function rebrandPublication(path, input, { repoSlug, original = input, siteHost }) {
  input = rebrandPorts(path, input);
  if (path === "public-docs/hub/self-hosting/index.md") {
    return rebrandHubDocs(path, rebrandHub(path, input, repoSlug), siteHost);
  }
  if (path.startsWith("packages/hub/")) return rebrandHub(path, input, repoSlug);
  if (hostedHubDoc.test(path)) return archiveHostedHubDoc(original);
  if (divergentChineseDocs.has(path)) return archiveDivergentDoc(path, original);
  input = rebrandHubDocs(path, input, siteHost);
  if (publicationPath(path) !== path) return archivePost(input);
  if (path === "packages/website/src/components/legal-page.tsx") {
    return rebrandLegal(input).replace(
      /      NIF\/VAT ID: ES26617095T\n[\s\S]*?      08005 Barcelona, Spain\n      <br \/>\n/,
      "",
    );
  }
  if (/^packages\/website\/src\/routes\/(privacy|terms)\.tsx$/.test(path)) {
    return rebrandLegal(input).replace(
      /These Terms govern the official services operated at clisbot\.com, relay\.[\w.-]+, and\n        hub\.[\w.-]+\. By using the official relay or hosted Hub, you agree to them\./,
      "These Terms apply to services operated by Clisbot. Third-party services are governed by\n        their operators&apos; terms. By using Clisbot-operated services, you agree to these Terms.",
    );
  }
  if (path === "packages/website/src/components/landing-page.tsx") {
    return removeUpstreamTestimonials(input);
  }
  if (path === "packages/website/src/posts.ts") return rebrandPosts(input);
  if (path === "packages/website/src/routes/blog/$.tsx") return rebrandByline(input);
  if (path === "packages/website/src/routes/hub.tsx") {
    return input.replaceAll('author="moboudra"', 'author="long"');
  }
  return input;
}

function rebrandHub(path, input, repoSlug) {
  const owner = repoSlug.split("/")[0].toLowerCase();
  let result = input.replaceAll("ghcr.io/getpaseo/hub", `ghcr.io/${repoSlug.toLowerCase()}`);
  if (/^packages\/hub\/fly(?:\.example)?\.toml$/.test(path)) {
    result = result.replace(
      /dockerfile = ["']Dockerfile["']/,
      `image = "ghcr.io/${repoSlug.toLowerCase()}:latest"`,
    );
    if (!result.includes("CLISBOT_RUN_MODE")) {
      result = result.replace("[env]\n", "[env]\nCLISBOT_RUN_MODE = 'hub'\n");
    }
  }
  if (path === "packages/hub/README.md" || path === "public-docs/hub/self-hosting/index.md") {
    result = result.replaceAll(
      "git clone https://github.com/getpaseo/hub.git\ncd hub",
      `git clone https://github.com/${repoSlug}.git\ncd clisbot/packages/hub`,
    );
  }
  if (path === "packages/hub/compose.yml" && !result.includes("CLISBOT_RUN_MODE:")) {
    result = result.replace(
      "      DATABASE_URL:",
      "      CLISBOT_RUN_MODE: hub\n      DATABASE_URL:",
    );
  }
  if (path === "packages/hub/scripts/release-metadata.mjs") {
    result = result.replace("}/hub`", "}/clisbot`");
  }
  if (path === "packages/hub/scripts/release-metadata.node-test.mjs") {
    result = result.replaceAll('imageTags("GetClisbot",', `imageTags("${owner}",`);
  }
  if (path === "packages/hub/.github/workflows/release.yml") {
    // This nested workflow owns Hub release notes only. The root Docker workflow
    // is the sole publisher of the shared daemon + Hub image.
    if (result.includes("      - uses: docker/setup-qemu-action@")) {
      result = removeBlock(
        result,
        "      - uses: docker/setup-qemu-action@",
        "      - name: Create or update GitHub release",
      );
    }
    result = result.replace("  packages: write\n", "");
  }
  return result;
}

function rebrandLegal(input) {
  return input
    .replaceAll("Mohamed Boudra Ziani", "Long Luong")
    .replaceAll("hello@moboudra.com", "clisbot@gmail.com")
    .replace('lastUpdated="August 29, 2026"', 'lastUpdated="September 30, 2026"');
}

function archiveDivergentDoc(path, input) {
  const frontmatter = input.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!frontmatter) throw new Error(`Review upstream translated guide before archiving: ${path}`);
  const notice = `Archived upstream Chinese documentation from [getpaseo/paseo](https://github.com/getpaseo/paseo), source \`${path}\`. Describes Paseo's contract, not the current Clisbot guide. Excluded from clisbot.com/docs; this zh-CN page uses the current Clisbot English original until a reviewed translation matches its contract.`;
  return input.replace(frontmatter[0], `${frontmatter[0]}\n> ${notice}\n`);
}

function archiveHostedHubDoc(input) {
  const frontmatter = input.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!frontmatter) throw new Error("Review upstream Hosted Hub frontmatter before archiving");
  const notice =
    "Archived upstream Hosted Hub documentation from [getpaseo/paseo](https://github.com/getpaseo/paseo). Describes Paseo’s service, not a Clisbot-operated service. Excluded from clisbot.com/docs; Clisbot removed its Hosted Hub page in commit `7e68c03e28dea323adc3c52356cea0d2698313c1`.";
  return input.replace(frontmatter[0], `${frontmatter[0]}\n> ${notice}\n`);
}

function archivePost(input) {
  const original = input.replaceAll("Clisbot", "Paseo");
  const frontmatter = original.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!frontmatter) throw new Error("Review upstream blog frontmatter before archiving");
  return original.replace(
    frontmatter[0],
    `${frontmatter[0]}\n> Archived upstream article by Mo Boudra about Paseo. Source: [getpaseo/paseo](https://github.com/getpaseo/paseo). Excluded from the Clisbot blog.\n`,
  );
}

function removeUpstreamTestimonials(input) {
  if (!input.includes("SOCIAL_PROOF_TWEETS") && !input.includes("SocialProofWall")) return input;
  const withoutData = removeBlock(input, "const SOCIAL_PROOF_TWEETS = [", "function AgentBadge(");
  // v0.11 moved the provider icon constant away; the wall now ends at the next section.
  const withoutWall = removeBlock(withoutData, "function SocialProofWall()", [
    "const PROVIDER_ICON_CLASS",
    "function MultiProviderSection(",
  ]);
  return replaceKnown(withoutWall, "            <SocialProofWall />\n", "");
}

function rebrandPosts(input) {
  let result = input.includes('"!../posts/upstream/**/*.md"')
    ? input
    : replaceKnown(
        input,
        'import.meta.glob("../posts/**/*.md", {',
        'import.meta.glob(["../posts/**/*.md", "!../posts/upstream/**/*.md"], {',
      );
  if (!result.includes("  author?: string;")) {
    result = replaceKnown(result, "  draft: boolean;\n", "  draft: boolean;\n  author?: string;\n");
  }
  if (!result.includes('author: data.author ?? "Clisbot"')) {
    result = replaceKnown(
      result,
      '        title: data.title ?? "",\n',
      '        title: data.title ?? "",\n        author: data.author ?? "Clisbot",\n',
    );
  }
  return result;
}

function rebrandByline(input) {
  if (!input.includes('href="https://x.com/moboudra"')) return input;
  const before = input.match(
    /          <a\n            href="https:\/\/x\.com\/moboudra"[\s\S]*?          <\/a>/,
  )?.[0];
  if (!before) throw new Error("Review upstream blog author markup");
  return input.replace(
    before,
    '          <span className="font-medium">{post.frontmatter.author}</span>',
  );
}

function removeBlock(input, start, ends) {
  const first = input.indexOf(start);
  const last =
    first < 0
      ? -1
      : ([ends]
          .flat()
          .map((end) => input.indexOf(end, first + start.length))
          .filter((index) => index >= 0)
          .sort((a, b) => a - b)[0] ?? -1);
  if (first < 0 || last < 0) throw new Error(`Review upstream publication block: ${start}`);
  return input.slice(0, first) + input.slice(last);
}

function replaceKnown(input, before, after) {
  if (after && input.includes(after)) return input;
  if (!input.includes(before)) throw new Error(`Review upstream publication anchor: ${before}`);
  return input.replace(before, after);
}
