/** Native press responders do not synthesize a browser compatibility click. */
export function preventHeldSendClick(): () => void {
  return () => undefined;
}
