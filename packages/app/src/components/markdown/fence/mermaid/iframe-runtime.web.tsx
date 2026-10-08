import { useCallback, useEffect, useRef, useState } from "react";
import type { DiagramColorScheme, MermaidRenderRequest } from "./render-model";
import { parseMermaidRuntimeMessage, type MermaidRuntimeRenderMessage } from "./runtime/messages";
import { MermaidRuntimeRequestDriver } from "./runtime/request-driver";

let runtimeHtml: Promise<string> | null = null;

// The runtime document is ~3.6 MB. Loading it with the first diagram keeps it out of the web
// entry bundle, which Cloudflare Workers (app.clisbot.com) rejects above 25 MiB.
function loadRuntimeHtml(): Promise<string> {
  runtimeHtml ??= import("./runtime/html.gen").then(
    (module) => module.mermaidRuntimeHtml,
    (error: unknown) => {
      runtimeHtml = null;
      throw error;
    },
  );
  return runtimeHtml;
}

export interface MermaidRenderedMessage {
  revision: number;
  source: string;
  colorScheme: DiagramColorScheme;
  height: number;
  width: number;
}

interface MermaidIframeRuntimeProps {
  request: MermaidRenderRequest | null;
  onRendered: (message: MermaidRenderedMessage) => void;
  onRenderFailed: (revision: number) => void;
}

/** Sandboxed Mermaid renderer. Sizing and gestures belong to the surrounding viewport. */
export function MermaidIframeRuntime({
  request,
  onRendered,
  onRenderFailed,
}: MermaidIframeRuntimeProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const driverRef = useRef<MermaidRuntimeRequestDriver | null>(null);
  driverRef.current ??= new MermaidRuntimeRequestDriver();
  const html = useRuntimeHtml(request, onRenderFailed);

  const sendRequest = useCallback((current: MermaidRenderRequest | null) => {
    const target = iframeRef.current?.contentWindow;
    if (!current || !target) return;
    const message: MermaidRuntimeRenderMessage = {
      type: "render",
      revision: current.revision,
      source: current.source,
      colorScheme: current.colorScheme,
      interactive: false,
    };
    target.postMessage(message, "*");
  }, []);

  useEffect(() => {
    sendRequest(driverRef.current?.update(request) ?? null);
  }, [request, sendRequest]);

  useEffect(() => {
    function receiveMessage(event: MessageEvent): void {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = parseMermaidRuntimeMessage(event.data);
      if (!message) return;
      if (message.type === "bridgeReady") {
        sendRequest(driverRef.current?.ready() ?? null);
        return;
      }
      if (message.type === "renderError") {
        onRenderFailed(message.revision);
        sendRequest(driverRef.current?.settled(message.revision, false) ?? null);
        return;
      }
      onRendered(message);
      sendRequest(driverRef.current?.settled(message.revision, true) ?? null);
    }
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [onRenderFailed, onRendered, sendRequest]);

  if (html === null) return null;

  // `inert` (not just tabIndex) because the Modal focus trap focuses descendants
  // programmatically; a focused iframe swallows every keystroke, including Escape.
  return (
    <iframe
      ref={iframeRef}
      title=""
      aria-hidden
      inert
      sandbox="allow-scripts"
      srcDoc={html}
      tabIndex={-1}
      style={iframeStyle}
    />
  );
}

/** The runtime document once loaded. A failed load fails the pending render, so the fence
 * falls back to its source; the request driver holds requests until the iframe is ready. */
function useRuntimeHtml(
  request: MermaidRenderRequest | null,
  onRenderFailed: (revision: number) => void,
): string | null {
  const [html, setHtml] = useState<string | null>(null);
  const failRef = useRef({ request, onRenderFailed });
  failRef.current = { request, onRenderFailed };

  useEffect(() => {
    let active = true;
    async function load(): Promise<void> {
      try {
        const loaded = await loadRuntimeHtml();
        if (active) setHtml(loaded);
      } catch {
        const pending = failRef.current.request;
        if (active && pending) failRef.current.onRenderFailed(pending.revision);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  return html;
}

const iframeStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  border: 0,
  pointerEvents: "none",
  background: "transparent",
};
