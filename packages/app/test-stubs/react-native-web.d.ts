// react-native-web ships no type declarations (no `types` field, no @types package).
// Only the vitest alias stub imports it by bare specifier; app code imports the
// `react-native` alias, which is typed through react-native-web.d.ts at the
// package root. Shorthand ambient modules only work in global (non-module) files.
declare module "react-native-web";
