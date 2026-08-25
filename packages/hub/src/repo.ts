export function splitRepoFullName(repoFullName: string): [string, string] {
  const parts = repoFullName.split("/");

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`invalid repo name: ${repoFullName}`);
  }

  return [parts[0], parts[1]];
}
