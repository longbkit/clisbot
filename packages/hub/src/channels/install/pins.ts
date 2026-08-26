// Pin manifest (channel-pins.json) — the trust boundary for the OpenClaw channel
// supply (plan §14.4: public npm, no mirror; the `dist.integrity` is what protects
// against tampering). One shared main package + one entry per channel. This module
// parses and validates the manifest; the installer consumes it.
//
// The main package records no `gitHead` on the registry; channel packages do
// (plan §3-C), so `gitHead` is optional on the main pin and required on channel
// pins that are published as their own package.

import { readFileSync } from "node:fs";
import { z } from "zod";

const npmPackageSchema = z
  .string()
  .regex(/^(@[a-z0-9-~][a-z0-9.-~]*)\/([a-z0-9-~][a-z0-9.-~]*)|([a-z0-9-~][a-z0-9.-~]*)$/)
  .refine((v) => v.trim() !== "", "package name must be set");

const npmVersionSchema = z.string().min(1);

const npmIntegritySchema = z
  .string()
  .regex(/^sha512-[A-Za-z0-9+/]+=*$/, "integrity must be an npm `sha512-…` value");

const gitHeadSchema = z.string().regex(/^[0-9a-f]{40}$/);

/** The pinned OpenClaw main package (shared by every channel). */
export const MainPinSchema = z
  .object({
    package: npmPackageSchema,
    version: npmVersionSchema,
    dist: z.object({
      integrity: npmIntegritySchema,
    }),
  })
  .strict();
export type MainPin = z.infer<typeof MainPinSchema>;

/** A channel's pinned package. `gitHead` is recorded for channel packages
 * (plan §3-C); the main package is referenced by `channel` when a channel is
 * inlined in the main package (bundled Telegram, plan §7 / finding #0). */
export const ChannelPinSchema = z
  .object({
    package: npmPackageSchema,
    version: npmVersionSchema,
    dist: z
      .object({
        integrity: npmIntegritySchema,
        gitHead: gitHeadSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type ChannelPin = z.infer<typeof ChannelPinSchema>;

/** The three loading modes: `published` (dist imports
 * `openclaw/plugin-sdk/*` externally, alias surface) and `bundled` (SDK inlined in
 * the main package, no alias surface, loads by `file://` URL) are the pinned-OpenClaw
 * supply forms; `in-repo` (blueprint §6.5) loads the Hub's OWN workspace package
 * (`inRepoPackage`) — trusted first-party code, no tarball, no integrity gate. The
 * `channel` pin on an in-repo entry stays the UPSTREAM SYNC REFERENCE (integrity +
 * gitHead intact) so re-syncs keep their provenance. */
export const LoadModeSchema = z.enum(["published", "bundled", "in-repo"]);
export type LoadMode = z.infer<typeof LoadModeSchema>;

/** The in-repo channel package name (`@getpaseo/channels-<channel>`). Present
 * exactly when `loadMode` is `in-repo`. */
const inRepoPackageSchema = z
  .string()
  .regex(/^@getpaseo\/channels-[a-z0-9-]+$/, "in-repo packages are @getpaseo/channels-<channel>");

/** The channel's plugin chunk reference (implementation doc §4.8 D1): the entry
 * object is a `defineBundledChannelEntry` result whose plugin lives at a
 * SEPARATE chunk, not inlined. The loader imports this chunk through the Hub's
 * own hooks (never `entry.loadChannelPlugin()`, which would resolve the
 * bound subpaths into the real main kernel and bypass the seam) and drives
 * `plugin.gateway.startAccount` / reads `plugin.outbound`. */
export const PluginPinSchema = z
  .object({
    /** Path of the plugin module relative to the channel install dir. */
    specifier: z.string().min(1),
    /** The named export that is the plugin object. */
    exportName: z.string().min(1),
  })
  .strict();
export type PluginPin = z.infer<typeof PluginPinSchema>;

export const ChannelPinEntrySchema = z
  .object({
    channel: ChannelPinSchema,
    loadMode: LoadModeSchema,
    /** The in-repo workspace package (`in-repo` loadMode only). */
    inRepoPackage: inRepoPackageSchema.optional(),
    /** Path of the channel entry module relative to the installed package root
     * (where the `defineBundledChannelEntry` object is the default export). */
    entry: z.string().min(1),
    /** The plugin chunk + named export the control plane drives (§4.8 D1). */
    plugin: PluginPinSchema,
    /** Label that must appear as a heading in THIRD_PARTY_NOTICES; install refuses
     * to run when the channel's section is missing (implementation doc §4.6 n9). */
    notices: z.string().min(1),
  })
  .strict()
  .refine((entry) => (entry.loadMode === "in-repo") === (entry.inRepoPackage !== undefined), {
    message: 'inRepoPackage must be set exactly when loadMode is "in-repo"',
  });
export type ChannelPinEntry = z.infer<typeof ChannelPinEntrySchema>;

export const ChannelPinsSchema = z
  .object({
    // Top-level document metadata only — allowed but ignored by the trust logic.
    // Kept explicit (not passthrough) so any other unknown top-level key still
    // fails, and the per-entry schemas stay strict.
    $schema: z.string().optional(),
    note: z.string().optional(),
    registry: z.string().url(),
    main: MainPinSchema,
    channels: z.record(z.string().min(1), ChannelPinEntrySchema),
  })
  .strict();
export type ChannelPins = z.infer<typeof ChannelPinsSchema>;

export class PinManifestError extends Error {
  readonly channel?: string;
  constructor(message: string, options?: { channel?: string }) {
    super(message);
    this.name = "PinManifestError";
    if (options?.channel !== undefined) this.channel = options.channel;
  }
}

/** Parse + validate a `channel-pins.json` document. */
export function parseChannelPins(doc: unknown): ChannelPins {
  const parsed = ChannelPinsSchema.safeParse(doc);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new PinManifestError(`invalid channel-pins.json: ${issues}`);
  }
  return parsed.data;
}

/** Read + parse `channel-pins.json` from disk. */
export function loadChannelPins(path: string): ChannelPins {
  const raw = readFileSync(path, "utf8");
  return parseChannelPins(JSON.parse(raw));
}

/** Resolve the pinned main package. A `bundled` channel reuses the main package as
 * its own channel package; a `published` channel ships a separate tarball. */
export function resolveMainPackage(pins: ChannelPins, channel: string): MainPin | ChannelPin {
  const entry = pins.channels[channel];
  if (!entry) throw new PinManifestError(`unknown channel: ${channel}`, { channel });
  // The channel pin and the main pin are the same package when the channel is
  // inlined in the main package (Telegram). Detect by package+version identity.
  const main = pins.main;
  if (entry.channel.package === main.package && entry.channel.version === main.version) {
    return main;
  }
  return entry.channel;
}
