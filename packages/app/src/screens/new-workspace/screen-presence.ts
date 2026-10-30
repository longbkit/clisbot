import { useCallback, useEffect, useRef } from "react";
import { useReadRoutePath } from "@/navigation/route-source";

const NEW_WORKSPACE_PATHNAME = "/new";

export interface NewWorkspaceScreenPresence {
  isMounted: boolean;
  pathname: string;
}

/**
 * Workspace creation blocks on a slow daemon RPC, so by the time it resolves the user may have
 * moved on. Both signals are needed: popping to a workspace unmounts the screen while its last
 * observed pathname stays "/new", and pushing a route on top of it keeps it mounted underneath.
 */
export function isNewWorkspaceScreenActive(input: NewWorkspaceScreenPresence): boolean {
  return input.isMounted && input.pathname === NEW_WORKSPACE_PATHNAME;
}

/**
 * Reads the route when asked rather than subscribing: the Home tab renders this screen, and a
 * subscription re-rendered all of it on every push and pop above the tabs.
 */
export function useNewWorkspaceScreenPresence(activePath = NEW_WORKSPACE_PATHNAME): () => boolean {
  const readPathname = useReadRoutePath();
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return useCallback(
    () => isMountedRef.current && readPathname() === activePath,
    [activePath, readPathname],
  );
}

export function startScreenPath(home: boolean): string {
  return home ? "/open-project" : NEW_WORKSPACE_PATHNAME;
}
