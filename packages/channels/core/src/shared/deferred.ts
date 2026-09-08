// upstream: src/shared/deferred.ts@5d8067a4483
export type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type PromiseConstructorWithResolvers = PromiseConstructor & {
  withResolvers<T>(): Deferred<T>;
};

const promiseWithResolvers = Promise as PromiseConstructorWithResolvers;

export function createDeferredCore<T = void>(): Deferred<T> {
  return promiseWithResolvers.withResolvers<T>();
}
