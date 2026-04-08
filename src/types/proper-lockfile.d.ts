declare module "proper-lockfile" {
  type LockOptions = {
    retries?:
      | number
      | {
          retries?: number;
          factor?: number;
          minTimeout?: number;
          maxTimeout?: number;
          randomize?: boolean;
        };
    stale?: number;
  };

  export function lock(
    file: string,
    options?: LockOptions,
  ): Promise<() => Promise<void>>;
}
