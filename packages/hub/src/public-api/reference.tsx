import { ApiReferenceReact, type AnyApiReferenceConfiguration } from "@scalar/api-reference-react";
// @ts-expect-error Vite resolves the package-exported CSS as inline text at build time.
import scalarStyles from "@scalar/api-reference-react/style.css?inline";

const referenceStyle = { minHeight: "100vh" };
const referenceConfiguration = {
  url: "/api/openapi.json",
  metaData: { title: "Paseo Hub Public API" },
  theme: "default",
  layout: "modern",
  showSidebar: true,
  hideModels: false,
  hideClientButton: true,
  hideTestRequestButton: true,
  persistAuth: false,
  telemetry: false,
  withDefaultFonts: false,
  agent: { disabled: true },
  mcp: { disabled: true },
  externalUrls: {
    dashboardUrl: "/api/reference",
    registryUrl: "/api/openapi.json",
    proxyUrl: "/api/reference",
    apiBaseUrl: "/api/reference",
  },
  customCss: `${scalarStyles}\n:root { --scalar-font: ui-sans-serif, system-ui, sans-serif; --scalar-font-code: ui-monospace, monospace; }`,
} satisfies AnyApiReferenceConfiguration;

export function PublicApiReference() {
  return (
    <main aria-label="Paseo Hub API reference" style={referenceStyle}>
      <ApiReferenceReact configuration={referenceConfiguration} />
    </main>
  );
}
