import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  addPartial,
  addWorkflow,
  configurationDraft,
  documentsOf,
  editSelected,
  isModified,
  PartialPathUnavailable,
  removePartial,
  removeWorkflow,
  selectDocument,
  selectedDocument,
  CONFIGURATION_DOCUMENT_ID,
  EMPTY_CONFIGURATION,
} from "./draft.js";

const revision = {
  files: [
    { path: ".paseo/workflows/triage.yml", content: "name: triage" },
    { path: ".paseo/hub.yml", content: "environments: {}\nagents: {}\n" },
    { path: ".paseo/workflows/partials/triage/preamble.md", content: "Triage first." },
  ],
};

describe("configuration bundle draft", () => {
  it("lists every authored source path and opens hub.yml", () => {
    const draft = configurationDraft(revision);
    assert.equal(selectedDocument(draft).id, CONFIGURATION_DOCUMENT_ID);
    assert.deepEqual(
      documentsOf(draft).map(({ label }) => label),
      [
        ".paseo/hub.yml",
        ".paseo/workflows/partials/triage/preamble.md",
        ".paseo/workflows/triage.yml",
      ],
    );
  });

  it("starts without a revision on the canonical resource document", () => {
    const draft = configurationDraft({ files: [] });
    assert.equal(selectedDocument(draft).content, EMPTY_CONFIGURATION);
    assert.equal(isModified(draft, draft), false);
  });

  it("edits only the selected source document", () => {
    const draft = configurationDraft(revision);
    const edited = editSelected(
      selectDocument(draft, ".paseo/workflows/triage.yml"),
      "name: changed",
    );
    assert.equal(selectedDocument(edited).content, "name: changed");
    assert.equal(
      edited.files.find(({ path }) => path === ".paseo/hub.yml")?.content,
      revision.files[1]?.content,
    );
    assert.equal(isModified(edited, draft), true);
  });

  it("adds and removes direct workflows and shared partials", () => {
    const baseline = configurationDraft(revision);
    const withWorkflow = addWorkflow(baseline, "review");
    assert.equal(withWorkflow.selectedId, ".paseo/workflows/review.yml");
    const withPartial = addPartial(withWorkflow, "review/checklist");
    assert.equal(withPartial.selectedId, ".paseo/workflows/partials/review/checklist.md");
    assert.equal(selectedDocument(withPartial).language, "markdown");
    assert.equal(
      removeWorkflow(
        removePartial(withPartial, ".paseo/workflows/partials/review/checklist.md"),
        ".paseo/workflows/review.yml",
      ).files.length,
      baseline.files.length,
    );
  });

  it("rejects duplicate, empty, traversal, and nested workflow paths", () => {
    const draft = configurationDraft(revision);
    assert.throws(() => addWorkflow(draft, "triage.yml"), PartialPathUnavailable);
    assert.throws(() => addWorkflow(draft, "nested/run.yml"), PartialPathUnavailable);
    assert.throws(() => addPartial(draft, "../secret.md"), PartialPathUnavailable);
    assert.throws(() => addPartial(draft, "  "), PartialPathUnavailable);
  });
});
