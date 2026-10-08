import { useEffect } from "react";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { BotFormModel, BotFormState } from "./bot-form-model";

/**
 * Asks the Host which template files a bot from a Project would write and which the Project
 * already has, so the form can ask which side wins before anything is written. Again when the
 * template or provider changes: the provider decides the `CLAUDE.md`/`GEMINI.md` link.
 */
export function useBotTemplatePreview(model: BotFormModel, state: BotFormState): void {
  const serverId = state.selectedServerId;
  const path = state.project?.path ?? null;
  const choice = state.template.choice;
  const provider = state.selectedProvider;
  useEffect(() => {
    if (!serverId || !path || choice === "none") return;
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) return;
    let current = true;
    void (async () => {
      try {
        const request = { path, kind: choice, ...(provider ? { provider } : {}) };
        const result = await client.previewBotTemplate(request);
        if (current) model.applyTemplatePreview(result.error ? [] : result.files);
      } catch {
        // No preview: nothing is listed, so every existing file is kept.
        if (current) model.applyTemplatePreview([]);
      }
    })();
    return () => {
      current = false;
    };
  }, [choice, model, path, provider, serverId]);
}
