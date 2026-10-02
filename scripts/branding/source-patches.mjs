import { colors, icon, runtimePath } from "./artwork.mjs";

const path = runtimePath();
const smallPath = runtimePath(true);
const legacyPath = /M291\.495 91\.399[^"']+Z/g;

function logoSource(input, file) {
  if (!input.includes(path) && !input.includes("M291.495 91.399")) {
    throw new Error(`Unrecognized upstream logo in ${file}; review it before applying branding.`);
  }
  return input.replace(legacyPath, path);
}

function appConfig(input) {
  let result = input.replace(
    /(adaptiveIcon:\s*\{\s*backgroundColor:\s*)"#[0-9a-fA-F]+"/,
    `$1"${colors.ocean}"`,
  );
  if (!result.includes('monochromeImage: "./assets/images/android-icon-monochrome.png"')) {
    result = result.replace(
      'foregroundImage: "./assets/images/android-icon-foreground.png",',
      'foregroundImage: "./assets/images/android-icon-foreground.png",\n        monochromeImage: "./assets/images/android-icon-monochrome.png",',
    );
  }
  result = result.replace(
    /(icon:\s*"\.\/assets\/images\/notification-icon.png",\s*color:\s*)"#[0-9a-fA-F]+"/,
    `$1"${colors.ocean}"`,
  );
  result = result.replace(
    /(image:\s*"\.\/assets\/images\/splash-icon.png",[\s\S]*?backgroundColor:\s*)"#[0-9a-fA-F]+"/,
    `$1"${colors.paper}"`,
  );
  result = result.replace(
    /(dark:\s*\{\s*(?:image:\s*"\.\/assets\/images\/splash-icon-dark.png",\s*)?)backgroundColor:\s*"#[0-9a-fA-F]+"/,
    `dark: {\n            image: "./assets/images/splash-icon-dark.png",\n            backgroundColor: "${colors.ocean}"`,
  );
  for (const anchor of ["android-icon-monochrome.png", "splash-icon-dark.png", colors.ocean]) {
    if (!result.includes(anchor)) throw new Error(`App config branding anchor missing: ${anchor}`);
  }
  return result;
}

function hubGlyph(input) {
  if (input.includes(smallPath)) return input;
  if (!input.includes('d="M4 12.5V4.5a1 1 0 0 1 1-1h3.5a3 3 0 0 1 0 6H4"')) {
    throw new Error("Unrecognized Hub glyph; review upstream changes.");
  }
  return input.replace(
    /<svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">[\s\S]*?<\/svg>/,
    `<svg viewBox="0 0 700 700" className="size-4" fill="currentColor" aria-hidden="true">\n      <path fillRule="evenodd" d="${smallPath}" />\n    </svg>`,
  );
}

function hubFavicon(input) {
  const data = `data:image/svg+xml,${encodeURIComponent(icon({ size: 32, coverage: 0.72 }).trim())}`;
  const match = input.match(/href: "data:image\/svg\+xml,[^"]+"/);
  if (!match) throw new Error("Hub inline favicon not found; review upstream changes.");
  return input.replace(match[0], `href: "${data}"`);
}

function appFavicon(input) {
  if (!input.includes("FAVICON_IMAGES") || !input.includes("/assets/images/favicon-")) {
    throw new Error("Unrecognized app favicon selector; review upstream changes.");
  }
  return input
    .replaceAll("../../assets/images/favicon-light", "../../assets/images/favicon-dark")
    .replace("favicon-${colorScheme}${suffix}", "favicon-dark${suffix}");
}

const logoFiles = [
  "packages/app/src/components/icons/clisbot-logo.tsx",
  "packages/app/src/screens/startup-splash-screen.tsx",
  "packages/website/src/components/mockup/icons.tsx",
  "packages/website/src/components/mockup/mobile/atoms.tsx",
];

export const sourcePatches = new Map(
  logoFiles.map((file) => [
    file,
    (input) => {
      let text = logoSource(input, file);
      text = text
        .replaceAll("BUTTERFLY_D", "CLISBOT_MARK_D")
        .replaceAll("butterfly", "Flow")
        .replace("brand swirl", "workspace and chat mark");
      if (file.endsWith("mobile/atoms.tsx")) {
        text = text.replace(
          'transform="translate(350,350) scale(1.05) translate(-350,-350)" ',
          'fillRule="evenodd" ',
        );
        text = text.replace("bg-black text-white", `bg-[${colors.ocean}] text-[${colors.seafoam}]`);
        text = text.replace("white Flow on the black app plate", "Ocean Flow on the app plate");
      } else if (file.endsWith("startup-splash-screen.tsx")) {
        text = text.replace("<path fill='black' d=", "<path fill-rule='evenodd' fill='black' d=");
      } else if (file.endsWith("clisbot-logo.tsx")) {
        if (!text.includes('fillRule="evenodd"'))
          text = text.replace("<Path\n", '<Path\n        fillRule="evenodd"\n');
      } else {
        text = text.replace(`<path d="${path}"`, `<path fillRule="evenodd" d="${path}"`);
      }
      return text;
    },
  ]),
);

sourcePatches.set("packages/hub/src/components/app/auth-layout.tsx", hubGlyph);
sourcePatches.set("packages/hub/src/routes/__root.tsx", hubFavicon);
sourcePatches.set("packages/app/app.config.js", appConfig);
sourcePatches.set("packages/app/src/hooks/use-favicon-status.ts", appFavicon);
sourcePatches.set("packages/app/src/utils/os-notifications.ts", (s) =>
  s.replace(
    "../../assets/images/notification-icon.png",
    "../../assets/images/browser-notification-icon.png",
  ),
);
sourcePatches.set("packages/website/src/routes/__root.tsx", (s) =>
  s.replace(
    '{ rel: "apple-touch-icon", href: "/favicon.svg" }',
    '{ rel: "apple-touch-icon", href: "/apple-touch-icon.png" }',
  ),
);
sourcePatches.set("packages/website/src/components/mockup/mobile/chat.tsx", (s) =>
  s.replace("Mohameds-MacBook-Pro.l…", "Work-Mac.local"),
);
sourcePatches.set("packages/website/src/components/mockup/sidebar.tsx", (s) =>
  s.replace("bg-black text-white", `bg-[${colors.ocean}] text-[${colors.seafoam}]`),
);
