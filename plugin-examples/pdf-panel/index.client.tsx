import type { PluginClientContext } from "@clisbot/plugin/client";
import { PdfPanel } from "./client/pdf-panel";

export default function contribute(client: PluginClientContext) {
  client.addFilePanel({
    id: "pdf",
    title: "PDF",
    icon: "FileText",
    files: { extensions: ["pdf"] },
    Component: PdfPanel,
  });
  return () => {};
}
