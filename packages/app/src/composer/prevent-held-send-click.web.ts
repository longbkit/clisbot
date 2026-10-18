/** Cancel only the compatibility click belonging to the touch that opened the menu. */
export function preventHeldSendClick(target: EventTarget = document): () => void {
  const clear = () => {
    target.removeEventListener("touchend", end, { capture: true });
    target.removeEventListener("touchcancel", clear, { capture: true });
  };
  const end = (event: Event) => {
    event.preventDefault();
    clear();
  };
  target.addEventListener("touchend", end, { capture: true, passive: false, once: true });
  target.addEventListener("touchcancel", clear, { capture: true, once: true });
  return clear;
}
