// COMPAT(pluginReactNativeEntrypoint): added in v0.13.0, remove after 2027-04-20
/** @deprecated Import Clisbot UI from @clisbot/plugin/client/ui. */
export * from "./ui.js";

/** @deprecated Render StreamedText from @clisbot/plugin/client/ui. Removed after 2027-04-20 with this entry. */
export declare function useRevealedText(text: string, phase: "streaming" | "complete"): string;
