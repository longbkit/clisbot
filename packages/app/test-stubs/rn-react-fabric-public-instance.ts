// Fabric public instances have no meaning on the web renderer; hand out the
// React element itself so callers that thread the instance around stay inert.
let nextTag = 1;

export function createPublicRootInstance(rootTag: number) {
  return rootTag;
}
export function createPublicInstance(tag: number, _type: string, _props: unknown) {
  return tag;
}
export function createPublicTextInstance(tag: number, _text: string, _rootTag: number) {
  return tag;
}
export function getNativeTagFromPublicInstance(instance: unknown): number | null {
  return typeof instance === "number" ? instance : nextTag++;
}
