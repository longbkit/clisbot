import {
  compareBundlePaths,
  HUB_RESOURCE_PATH,
  WORKFLOW_DIRECTORY,
  WORKFLOW_PARTIAL_DIRECTORY,
  type HubBundleFile,
} from "../../config/bundle-contract.js";

export const CONFIGURATION_DOCUMENT_ID = HUB_RESOURCE_PATH;

export interface ConfigurationDocument extends HubBundleFile {
  id: string;
  label: string;
  language: "yaml" | "markdown";
  isPartial: boolean;
  isWorkflow: boolean;
}

export interface ConfigurationDraft {
  files: readonly HubBundleFile[];
  selectedId: string;
}

export const EMPTY_CONFIGURATION = "environments: {}\nagents: {}\n";

export function configurationDraft(revision: {
  files: readonly HubBundleFile[];
}): ConfigurationDraft {
  const files =
    revision.files.length === 0
      ? [{ path: HUB_RESOURCE_PATH, content: EMPTY_CONFIGURATION }]
      : [...revision.files].sort(byPath);
  return { files, selectedId: HUB_RESOURCE_PATH };
}

export function documentsOf(draft: ConfigurationDraft): readonly ConfigurationDocument[] {
  return draft.files.map((file) => ({
    ...file,
    id: file.path,
    label: file.path,
    language: file.path.endsWith(".md") ? "markdown" : "yaml",
    isPartial: file.path.startsWith(`${WORKFLOW_PARTIAL_DIRECTORY}/`),
    isWorkflow:
      file.path.startsWith(`${WORKFLOW_DIRECTORY}/`) &&
      !file.path.startsWith(`${WORKFLOW_PARTIAL_DIRECTORY}/`),
  }));
}

export function selectedDocument(draft: ConfigurationDraft): ConfigurationDocument {
  const documents = documentsOf(draft);
  return documents.find(({ id }) => id === draft.selectedId) ?? documents[0]!;
}

export function selectDocument(draft: ConfigurationDraft, id: string): ConfigurationDraft {
  return draft.files.some(({ path }) => path === id) ? { ...draft, selectedId: id } : draft;
}

export function editSelected(draft: ConfigurationDraft, content: string): ConfigurationDraft {
  return {
    ...draft,
    files: draft.files.map((file) =>
      file.path === draft.selectedId ? { ...file, content } : file,
    ),
  };
}

export class PartialPathUnavailable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PartialPathUnavailable";
  }
}

export function addPartial(draft: ConfigurationDraft, path: string): ConfigurationDraft {
  return addFile(draft, `${WORKFLOW_PARTIAL_DIRECTORY}/${normalizeRelative(path, ".md")}`, "");
}

export function addWorkflow(draft: ConfigurationDraft, path: string): ConfigurationDraft {
  const relative = normalizeRelative(path, ".yml");
  if (relative.includes("/")) {
    throw new PartialPathUnavailable("Workflow files must be direct children of workflows/.");
  }
  return addFile(
    draft,
    `${WORKFLOW_DIRECTORY}/${relative}`,
    "name: new-workflow\non: manual.run\nmax_runtime: 1h\nsteps: []\n",
  );
}

export function removePartial(draft: ConfigurationDraft, path: string): ConfigurationDraft {
  return removeFile(
    draft,
    path.startsWith(`${WORKFLOW_PARTIAL_DIRECTORY}/`)
      ? path
      : `${WORKFLOW_PARTIAL_DIRECTORY}/${path}`,
  );
}

export function removeWorkflow(draft: ConfigurationDraft, path: string): ConfigurationDraft {
  return removeFile(
    draft,
    path.startsWith(`${WORKFLOW_DIRECTORY}/`) ? path : `${WORKFLOW_DIRECTORY}/${path}`,
  );
}

export function isModified(draft: ConfigurationDraft, baseline: ConfigurationDraft): boolean {
  if (draft.files.length !== baseline.files.length) return true;
  return draft.files.some((file, index) => {
    const original = baseline.files[index];
    return original?.path !== file.path || original.content !== file.content;
  });
}

function addFile(draft: ConfigurationDraft, path: string, content: string): ConfigurationDraft {
  if (draft.files.some((file) => file.path === path)) {
    throw new PartialPathUnavailable(`A file already exists at ${path}.`);
  }
  return {
    files: [...draft.files, { path, content }].sort(byPath),
    selectedId: path,
  };
}

function removeFile(draft: ConfigurationDraft, path: string): ConfigurationDraft {
  if (path === HUB_RESOURCE_PATH) return draft;
  const files = draft.files.filter((file) => file.path !== path);
  if (files.length === draft.files.length) return draft;
  return {
    files,
    selectedId: draft.selectedId === path ? HUB_RESOURCE_PATH : draft.selectedId,
  };
}

function normalizeRelative(path: string, extension: ".md" | ".yml"): string {
  const normalized = path.trim().replace(/^\/+|\/+$/gu, "");
  if (normalized.length === 0) throw new PartialPathUnavailable("Enter a file name.");
  if (normalized.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new PartialPathUnavailable("Paths cannot contain '.' or '..' segments.");
  }
  return normalized.endsWith(extension) ? normalized : `${normalized}${extension}`;
}

function byPath(left: HubBundleFile, right: HubBundleFile): number {
  if (left.path === HUB_RESOURCE_PATH) return -1;
  if (right.path === HUB_RESOURCE_PATH) return 1;
  return compareBundlePaths(left, right);
}
