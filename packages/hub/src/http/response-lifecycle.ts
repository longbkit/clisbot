export type ResponseFinishCleanup = () => void | Promise<void>;
export type ResponseAbortCleanup = () => void | Promise<void>;

export interface ResponseLifecycle {
  onFinish: ResponseFinishCleanup;
  onAbort?: ResponseAbortCleanup;
}

const responseLifecycles = new WeakMap<Response, ResponseLifecycle>();

export function registerResponseFinishCleanup(
  response: Response,
  cleanup: ResponseFinishCleanup,
): Response {
  responseLifecycles.set(response, { onFinish: cleanup });
  return response;
}

export function registerResponseLifecycle(
  response: Response,
  lifecycle: ResponseLifecycle,
): Response {
  responseLifecycles.set(response, lifecycle);
  return response;
}

export function takeResponseLifecycle(response: Response): ResponseLifecycle | undefined {
  const lifecycle = responseLifecycles.get(response);
  responseLifecycles.delete(response);
  return lifecycle;
}
