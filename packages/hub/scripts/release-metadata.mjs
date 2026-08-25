import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const releaseTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
const releaseHeadingPattern = /^##\s+([^\s]+)\s+-\s+(\d{4}-\d{2}-\d{2})\s*$/;

export function releaseMetadata({ tag, packageVersion, changelog }) {
  const tagMatch = releaseTagPattern.exec(tag);
  if (tagMatch === null) {
    throw new Error(`Release tag ${tag} must use v<major>.<minor>.<patch> syntax.`);
  }

  const version = tag.slice(1);
  if (version !== packageVersion) {
    throw new Error(`Release tag ${tag} does not match package.json version ${packageVersion}.`);
  }

  const lines = changelog.split(/\r?\n/);
  const headings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = releaseHeadingPattern.exec(lines[index]);
    if (match !== null) headings.push({ version: match[1], index });
  }

  const heading = headings.find((candidate) => candidate.version === version);
  if (heading === undefined) {
    throw new Error(`CHANGELOG.md has no release section for ${version}.`);
  }

  const nextHeading = headings.find((candidate) => candidate.index > heading.index);
  const notes = lines
    .slice(heading.index, nextHeading?.index ?? lines.length)
    .join("\n")
    .trim();
  if (notes === lines[heading.index].trim()) {
    throw new Error(`CHANGELOG.md release section ${version} has no notes.`);
  }

  return {
    version,
    prerelease: tagMatch[4] !== undefined,
    notes: `${notes}\n`,
  };
}

export function imageTags(owner, metadata) {
  const image = `ghcr.io/${owner.toLowerCase()}/hub`;
  const tags = [`${image}:${metadata.version}`];
  if (!metadata.prerelease) tags.push(`${image}:latest`);
  return tags;
}

function githubOutput(metadata, owner) {
  return [
    `version=${metadata.version}`,
    `prerelease=${metadata.prerelease}`,
    "image_tags<<EOF",
    ...imageTags(owner, metadata),
    "EOF",
    "",
  ].join("\n");
}

function main() {
  const [tag, notesPath] = process.argv.slice(2);
  if (!tag || !notesPath) {
    throw new Error("Usage: node scripts/release-metadata.mjs <tag> <notes-path>");
  }

  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const metadata = releaseMetadata({ tag, packageVersion: packageJson.version, changelog });
  writeFileSync(notesPath, metadata.notes);

  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("GITHUB_OUTPUT is required.");
  const owner = process.env.GITHUB_REPOSITORY_OWNER;
  if (!owner) throw new Error("GITHUB_REPOSITORY_OWNER is required.");
  appendFileSync(outputPath, githubOutput(metadata, owner));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
