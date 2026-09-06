import { createContext } from "react";

/** Navigate to the owning Automation without discarding the Channel Route draft. */
export const AutomationReplyNavigationContext = createContext<(() => void) | null>(null);
