// The real package is source-only (no compiled JS); bundling its source drags in
// expo-modules-core's NativeModule class. Browser tests only load the module
// graph, never invoke file I/O, so the class/namespace surface stays inert.
export class File {
  exists: boolean;
  uri: string;
  constructor(uri: string) {
    this.uri = uri;
    this.exists = false;
  }
}
export class Directory {
  uri: string;
  constructor(uri: string) {
    this.uri = uri;
  }
}
export class FileInfo {
  uri: string;
  isDirectory: boolean;
  constructor(uri: string, isDirectory: boolean) {
    this.uri = uri;
    this.isDirectory = isDirectory;
  }
}
export const Paths = {
  document: "",
  cache: "",
  temporary: "",
  root: "",
  bundle: "",
};
