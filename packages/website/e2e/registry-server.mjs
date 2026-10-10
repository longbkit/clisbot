import { createServer } from "node:http";
import registry from "./registry.fixture.json" with { type: "json" };

import securityPlugin from "./overview.fixture.json" with { type: "json" };

import overviewCorpus from "../../protocol/tests/fixtures/plugin-overview.json" with { type: "json" };
securityPlugin.readme +=
  "\n\n" +
  overviewCorpus
    .map(({ markdown }) => markdown + "\n\n```html\n" + markdown + "\n```")
    .join("\n\n");

// Serve the published registry contract so SSR and browser navigation use the same data.
createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/releases") {
    response.end(
      JSON.stringify([
        {
          tag_name: "v2.0.0",
          prerelease: false,
          draft: false,
          assets: [
            { name: "Clisbot-2.0.0-arm64.dmg" },
            { name: "Clisbot-x86_64.AppImage" },
            { name: "Clisbot-Setup-2.0.0-x64.exe" },
            { name: "clisbot-v2.0.0-android.apk" },
          ],
        },
      ]),
    );
    return;
  }
  if (request.url === "/index.json") {
    response.end(JSON.stringify(registry));
    return;
  }
  const plugin = [securityPlugin, ...registry.plugins].find(
    (entry) => request.url === `/plugins/${entry.id}.json`,
  );
  response.statusCode = plugin ? 200 : 404;
  response.end(JSON.stringify(plugin ?? { error: "Plugin not found" }));
}).listen(8188, "127.0.0.1");
