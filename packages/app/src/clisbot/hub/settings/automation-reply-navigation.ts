import { createContext } from "react";

/** Navigate to the owning Automation without discarding the Route draft. */
export const AutomationReplyNavigationContext = createContext<(() => void) | null>(null);
