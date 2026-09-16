import { describe, expect, it } from "vitest";
import {
  allocateDiffHeaderTextWidths,
  showsFileHeaderOpenAction,
} from "./file-header-presentation";

describe("diff file header text allocation", () => {
  it("gives the filename its full width before truncating the directory", () => {
    expect(
      allocateDiffHeaderTextWidths({ available: 120, nameWidth: 80, directoryWidth: 100 }),
    ).toEqual({ name: 80, directory: 36 });
  });

  it("uses all available width for a filename that cannot fit", () => {
    expect(
      allocateDiffHeaderTextWidths({ available: 60, nameWidth: 80, directoryWidth: 100 }),
    ).toEqual({ name: 60, directory: 0 });
  });

  it("does not truncate a fitting filename merely to reserve the gap", () => {
    expect(
      allocateDiffHeaderTextWidths({ available: 82, nameWidth: 80, directoryWidth: 100 }),
    ).toEqual({ name: 80, directory: 0 });
  });
});

describe("diff file header open action", () => {
  const treeRow = { canOpen: true, isDeleted: false, isDocumentHeader: false, isHovered: false };

  it("stays away without a handler to open the file with", () => {
    expect(showsFileHeaderOpenAction({ ...treeRow, canOpen: false, isHovered: true })).toBe(false);
  });

  it("stays away on a deleted file, which has nothing left to open", () => {
    expect(showsFileHeaderOpenAction({ ...treeRow, isDeleted: true, isHovered: true })).toBe(false);
  });

  it("shows on a document header, whose painted header reserves its slot", () => {
    expect(showsFileHeaderOpenAction({ ...treeRow, isDocumentHeader: true })).toBe(true);
  });

  it("reveals a tree row's action only while the row is hovered", () => {
    expect(showsFileHeaderOpenAction(treeRow)).toBe(false);
    expect(showsFileHeaderOpenAction({ ...treeRow, isHovered: true })).toBe(true);
  });
});
