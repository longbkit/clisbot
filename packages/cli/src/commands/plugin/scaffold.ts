import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PluginIdSchema } from "@clisbot/protocol/messages";
import { resolveCliVersion } from "../../version.js";

const TSCONFIG = {
  compilerOptions: {
    target: "ES2020",
    module: "ESNext",
    moduleResolution: "Bundler",
    lib: ["ES2023"],
    types: ["react"],
    jsx: "react-jsx",
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
  },
  include: ["**/*.ts", "**/*.tsx"],
};

const CLIENT_ENTRY = `import type { PluginClientContext } from "@clisbot/plugin/client";
import { GreetingSurface } from "./client/greeting";

export default function contribute(client: PluginClientContext) {
  client.addSurface("greeting", GreetingSurface);
  client.addSidebarItem({
    id: "greeting",
    title: "Greeting",
    icon: "MessageCircle",
    surface: "greeting",
  });
  return () => {};
}
`;

const SERVER_ENTRY = `import type { PluginServerContext } from "@clisbot/plugin/server";
import { createGreeting } from "./server/greeting";
import { greetingRpc } from "./shared/greeting";

export default function contribute(server: PluginServerContext) {
  server.handle(greetingRpc, createGreeting);
  return () => {};
}
`;

const SHARED_GREETING = `import { defineRpc } from "@clisbot/plugin";
import { z } from "zod";

export const greetingRpc = defineRpc({
  name: "greeting.create",
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
});
`;

const SERVER_GREETING = `import type { RpcInput } from "@clisbot/plugin";
import { greetingRpc } from "../shared/greeting";

export function createGreeting({ name }: RpcInput<typeof greetingRpc>) {
  return { message: "Hello, " + name + "!" };
}
`;

const CLIENT_GREETING = `import type { PluginSurfaceProps } from "@clisbot/plugin/client";
import { useRpc } from "@clisbot/plugin/client";
import { useMutation } from "@tanstack/react-query";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { greetingRpc } from "../shared/greeting";
import { openExternal } from "./web";

export function GreetingSurface({ theme, layout }: PluginSurfaceProps) {
  const createGreeting = useRpc(greetingRpc);
  const greeting = useMutation({ mutationFn: createGreeting });
  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: layout.compact ? 16 : 24,
        backgroundColor: theme.colors.surface0,
      },
      text: { color: theme.colors.foreground },
      button: { padding: 12, backgroundColor: theme.colors.accent },
      buttonText: { color: theme.colors.accentForeground },
    }),
    [theme, layout.compact],
  );
  return (
    <View style={styles.screen}>
      <Text style={styles.text}>{greeting.data?.message ?? "Ask the daemon for a greeting."}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create greeting"
        style={styles.button}
        onPress={() => greeting.mutate({ name: "Clisbot" })}
      >
        <Text style={styles.buttonText}>Create greeting</Text>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Open the Clisbot website"
        style={styles.button}
        onPress={() => openExternal("https://clisbot.com")}
      >
        <Text style={styles.buttonText}>Open clisbot.com</Text>
      </Pressable>
    </View>
  );
}
`;

const CLIENT_WEB = `import { Linking, Platform } from "react-native";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const window: { open(url: string, target: string, features: string): unknown };

export async function openExternal(url: string): Promise<void> {
  if (Platform.OS === "web") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(url);
}
`;

export interface PluginScaffold {
  id: string;
  directory: string;
}

export async function scaffoldPluginDirectory(
  targetDirectory: string,
  requestedId?: string,
): Promise<PluginScaffold> {
  const directory = path.resolve(targetDirectory);
  const id = PluginIdSchema.parse(requestedId ?? path.basename(directory));
  await mkdir(directory, { recursive: true });
  const existing = await readdir(directory);
  if (existing.length > 0) {
    throw new Error(`Plugin directory must be empty: ${directory}`);
  }

  const version = resolveCliVersion();
  const packageJson = {
    name: id,
    private: true,
    version: "0.0.0",
    files: [
      "clisbot-plugin.json",
      "index.client.ts",
      "index.client.tsx",
      "index.server.ts",
      "index.server.tsx",
      "client/",
      "server/",
      "shared/",
    ],
    scripts: { typecheck: "tsc --noEmit" },
    devDependencies: {
      "@clisbot/plugin": version,
      "@tanstack/react-query": "^5.90.11",
      "@types/react": "~19.2.0",
      react: "19.1.0",
      "react-native": "0.81.5",
      typescript: "^5.9.3",
      zod: "^4.4.3",
    },
  };
  const files = new Map<string, string>([
    [
      "clisbot-plugin.json",
      `${JSON.stringify({ id, requirements: { clisbot: `>=${version}` } }, null, 2)}\n`,
    ],
    ["package.json", `${JSON.stringify(packageJson, null, 2)}\n`],
    ["tsconfig.json", `${JSON.stringify(TSCONFIG, null, 2)}\n`],
    ["index.client.tsx", CLIENT_ENTRY],
    ["index.server.ts", SERVER_ENTRY],
    ["shared/greeting.ts", SHARED_GREETING],
    ["server/greeting.ts", SERVER_GREETING],
    ["client/greeting.tsx", CLIENT_GREETING],
    ["client/web.ts", CLIENT_WEB],
  ]);
  await Promise.all(
    ["shared", "server", "client"].map((name) => mkdir(path.join(directory, name))),
  );
  await Promise.all(
    [...files].map(([filename, contents]) =>
      writeFile(path.join(directory, filename), contents, { flag: "wx" }),
    ),
  );
  return { id, directory };
}
