import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../ui/button.js";
import { Field, FieldDescription, FieldLabel } from "../ui/field.js";

const CONFIRMATION_MS = 2000;

type CopyState = "idle" | "copied" | "manual";

/**
 * Copying a generated URL into a provider's portal is the single most repeated action on the
 * app setup surface, so the value and its copy control are one component. The accessible name
 * of the button never changes — the confirmation is announced in a live region instead, so a
 * screen reader hears "Copied Callback URL" without the button renaming itself under the user.
 */
function useCopy(label: string, value: string) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(() => {
    clearTimeout(timer.current);
    const write = navigator.clipboard?.writeText(value);
    if (write === undefined) {
      setState("manual");
      return;
    }
    // A denied permission or an insecure context is not an error the operator can act on by
    // retrying. Tell them to select the value instead, and leave the value on screen.
    void write
      .then(() => {
        setState("copied");
        timer.current = setTimeout(() => setState("idle"), CONFIRMATION_MS);
        return true;
      })
      .catch(() => setState("manual"));
  }, [value]);
  const announcement = state === "copied" ? `Copied ${label}` : "";
  return { state, copy, announcement };
}

function CopyButton({
  label,
  copied,
  onCopy,
  children,
}: {
  label: string;
  copied: boolean;
  onCopy: () => void;
  children?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={children === undefined ? "icon-sm" : "sm"}
      aria-label={children === undefined ? `Copy ${label}` : undefined}
      className="shrink-0"
      onClick={onCopy}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {children}
    </Button>
  );
}

function Announcement({ message }: { message: string }) {
  return (
    <span aria-live="polite" className="sr-only">
      {message}
    </span>
  );
}

export function CopyField({ label, value }: { label: string; value: string }) {
  const { state, copy, announcement } = useCopy(label, value);
  const text = useRef<HTMLSpanElement>(null);
  // The manual path has to leave the operator something to do: put the whole value in their
  // selection so the browser's own copy shortcut finishes the job.
  const select = useCallback(() => {
    const node = text.current;
    if (node === null) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);
  const onCopy = useCallback(() => {
    copy();
    select();
  }, [copy, select]);
  return (
    <Field className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-start gap-1 rounded-md border bg-background px-3 py-2">
        <span ref={text} className="min-w-0 flex-1 font-mono text-xs break-all">
          {value}
        </span>
        <CopyButton label={label} copied={state === "copied"} onCopy={onCopy} />
      </div>
      {state === "manual" ? (
        <FieldDescription>Select the value and copy it.</FieldDescription>
      ) : null}
      <Announcement message={announcement} />
    </Field>
  );
}

export function CopyBlock({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  /** The visible button text, e.g. "Copy manifest". */
  action: string;
}) {
  const { state, copy, announcement } = useCopy(label, value);
  return (
    <Field className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>{label}</FieldLabel>
        <CopyButton label={label} copied={state === "copied"} onCopy={copy}>
          {action}
        </CopyButton>
      </div>
      {/* Wrapping is what keeps the block inside its card. An unwrapped `pre` is as wide as its
          longest line, and that width propagates out through the section's grid tracks until the
          whole body is wider than the phone and the section clips the parts that no longer fit.
          `break-all` is what makes a bare URL a wrappable line rather than one long word. */}
      <pre
        aria-readonly="true"
        aria-label={`${label} value`}
        className="max-h-48 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap sm:max-h-64"
        role="textbox"
        tabIndex={0}
      >
        {value}
      </pre>
      {state === "manual" ? (
        <FieldDescription>Select the value and copy it.</FieldDescription>
      ) : null}
      <Announcement message={announcement} />
    </Field>
  );
}
