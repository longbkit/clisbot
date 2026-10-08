import { i18n } from "@/i18n/i18next";
import {
  parseChannelConfigurationYaml,
  type ChannelConfigurationCandidate,
} from "../channel-configuration";

export interface ChannelYamlSnapshot {
  source: string;
  revisionId: string | null;
}

interface ChannelYamlState {
  source: string;
  inputRevision: number;
  dirty: boolean;
  stale: boolean;
  validation: "idle" | "pending" | "valid" | "error";
  message: string;
  saving: boolean;
}

/** The error's own message, or the line for the step that failed. */
function failureMessage(
  error: unknown,
  step: "invalid" | "validationFailed" | "activationFailed",
): string {
  if (error instanceof Error) return error.message;
  if (step === "invalid") return i18n.t("hub.channels.yaml.invalid");
  if (step === "validationFailed") return i18n.t("hub.channels.yaml.validationFailed");
  return i18n.t("hub.channels.yaml.activationFailed");
}

export function openChannelYamlForm(initial: ChannelYamlSnapshot) {
  let latest = initial;
  let baseline = initial;
  let generation = 0;
  let state: ChannelYamlState = {
    source: initial.source,
    inputRevision: 0,
    dirty: false,
    stale: false,
    validation: "idle",
    message: "",
    saving: false,
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    state.dirty = state.source !== baseline.source;
    state.stale = baseline.revisionId !== latest.revisionId;
    for (const listener of listeners) listener();
  };
  const reset = (snapshot: ChannelYamlSnapshot) => {
    generation++;
    baseline = snapshot;
    publish({
      source: snapshot.source,
      inputRevision: state.inputRevision + 1,
      validation: "idle",
      message: "",
    });
  };
  const parse = (): ChannelConfigurationCandidate | null => {
    try {
      return parseChannelConfigurationYaml(state.source);
    } catch (error) {
      publish({
        validation: "error",
        message: failureMessage(error, "invalid"),
      });
      return null;
    }
  };
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      generation++;
    },
    change(source: string) {
      if (state.saving) return;
      generation++;
      publish({ source, validation: "idle", message: "" });
    },
    applySnapshot(snapshot: ChannelYamlSnapshot) {
      if (snapshot.revisionId === latest.revisionId && snapshot.source === latest.source) return;
      latest = snapshot;
      generation++;
      if (!state.dirty && !state.saving) reset(snapshot);
      else publish({ validation: "idle", message: "" });
    },
    reload() {
      if (!state.saving) reset(latest);
    },
    async validate(validate: (candidate: ChannelConfigurationCandidate) => Promise<void>) {
      if (state.saving || state.stale || state.validation === "pending") return;
      const candidate = parse();
      if (candidate === null) return;
      const request = ++generation;
      publish({ validation: "pending", message: "" });
      try {
        await validate(candidate);
        if (request === generation)
          publish({
            validation: "valid",
            message: i18n.t("hub.channels.yaml.valid"),
          });
      } catch (error) {
        if (request === generation)
          publish({
            validation: "error",
            message: failureMessage(error, "validationFailed"),
          });
      }
    },
    async activate(save: (candidate: ChannelConfigurationCandidate) => Promise<boolean>) {
      if (state.saving || state.stale || !state.dirty || state.validation === "pending") return;
      const candidate = parse();
      if (candidate === null) return;
      generation++;
      publish({ saving: true, validation: "idle", message: "" });
      try {
        if (await save(candidate)) {
          baseline = { source: state.source, revisionId: latest.revisionId };
          publish({ message: i18n.t("hub.channels.yaml.activated") });
        }
      } catch (error) {
        publish({
          validation: "error",
          message: failureMessage(error, "activationFailed"),
        });
      } finally {
        publish({ saving: false });
      }
    },
  };
}
