export interface Ok<T> {
  status: "ok";
  data: T;
}
export interface Err {
  status: "error";
  error: { message: string };
}
export type Result<T> = Ok<T> | Err;

export function respondOk<T>(data: T): Ok<T> {
  return { status: "ok", data };
}

export function respondError(error: { message: string }): Err {
  return { status: "error", error };
}
