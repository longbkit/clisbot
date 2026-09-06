import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";
import { registerWebConfirmation, type ConfirmDialogInput } from "@/utils/confirm-dialog";

export interface ConfirmationInput extends ConfirmDialogInput {
  body?: ReactNode;
}

interface ConfirmationRequest {
  id: number;
  owner: string;
  input: ConfirmationInput;
  resolve(value: boolean): void;
}

interface ConfirmationContextValue {
  confirm(owner: string, input: ConfirmationInput): Promise<boolean>;
  cancel(owner: string): void;
}

const ConfirmationContext = createContext<ConfirmationContextValue | null>(null);
const CONFIRMATION_SNAP_POINTS = ["40%", "65%"];
const DETAILED_CONFIRMATION_SNAP_POINTS = ["65%", "85%"];

interface ConfirmationProviderProps {
  children: ReactNode;
  webBackend?: boolean;
  scopeKey?: string;
}

export function ConfirmationProvider({
  children,
  webBackend = false,
  scopeKey,
}: ConfirmationProviderProps) {
  const compact = useIsCompactFormFactor();
  const pending = useRef<ConfirmationRequest | null>(null);
  const nextId = useRef(0);
  const mounted = useRef(true);
  const [dialog, setDialog] = useState<{
    request: ConfirmationRequest;
    visible: boolean;
  } | null>(null);

  const finish = useCallback((request: ConfirmationRequest, accepted: boolean) => {
    if (pending.current !== request) return;
    pending.current = null;
    setDialog((current) =>
      current?.request === request ? { ...current, visible: false } : current,
    );
    request.resolve(accepted);
  }, []);

  const confirm = useCallback((owner: string, input: ConfirmationInput): Promise<boolean> => {
    // A second click must not authorize two mutations from one confirmation.
    if (!mounted.current || pending.current !== null) return Promise.resolve(false);
    return new Promise((resolve) => {
      const request = { id: ++nextId.current, owner, input, resolve };
      pending.current = request;
      setDialog({ request, visible: true });
    });
  }, []);
  const cancel = useCallback(
    (owner: string) => {
      const request = pending.current;
      if (request?.owner === owner) finish(request, false);
    },
    [finish],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const request = pending.current;
      pending.current = null;
      request?.resolve(false);
    };
  }, []);
  useEffect(() => {
    if (!webBackend) return;
    const unregister = registerWebConfirmation((input) => confirm("app", input));
    return () => {
      unregister();
      cancel("app");
    };
  }, [cancel, confirm, scopeKey, webBackend]);
  const context = useMemo(() => ({ confirm, cancel }), [confirm, cancel]);
  const request = dialog?.request;
  const visible = dialog?.visible ?? false;
  const header = useMemo(() => ({ title: request?.input.title ?? "" }), [request?.input.title]);
  const handleCancel = useCallback(() => {
    if (request) finish(request, false);
  }, [finish, request]);
  const handleConfirm = useCallback(() => {
    if (request) finish(request, true);
  }, [finish, request]);
  const handleDismiss = useCallback(() => {
    if (!request) return;
    finish(request, false);
    setDialog((current) => (current?.request === request ? null : current));
  }, [finish, request]);
  const footer = useMemo(
    () =>
      request ? (
        <View style={[styles.actions, compact && styles.compactActions]}>
          <Button
            variant="secondary"
            style={compact ? undefined : styles.action}
            disabled={!visible}
            onPress={handleCancel}
          >
            {request.input.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={request.input.destructive ? "destructive" : "default"}
            style={compact ? undefined : styles.action}
            disabled={!visible}
            onPress={handleConfirm}
          >
            {request.input.confirmLabel ?? "Confirm"}
          </Button>
        </View>
      ) : null,
    [compact, handleCancel, handleConfirm, request, visible],
  );

  return (
    <ConfirmationContext.Provider value={context}>
      {children}
      {request ? (
        <AdaptiveModalSheet
          key={request.id}
          header={header}
          visible={visible}
          onClose={handleCancel}
          onDismiss={handleDismiss}
          snapPoints={
            request.input.body == null
              ? CONFIRMATION_SNAP_POINTS
              : DETAILED_CONFIRMATION_SNAP_POINTS
          }
          sizeContentToCurrentSnapPoint
          testID="app-confirmation"
          footer={footer}
        >
          {request.input.body ?? <Text style={styles.message}>{request.input.message}</Text>}
        </AdaptiveModalSheet>
      ) : null}
    </ConfirmationContext.Provider>
  );
}

export function useConfirmation(): (input: ConfirmationInput) => Promise<boolean> {
  const context = useContext(ConfirmationContext);
  if (context === null) throw new Error("Confirmation requires ConfirmationProvider");
  const owner = useId();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      context.cancel(owner);
    };
  }, [context, owner]);
  return useCallback(
    (input: ConfirmationInput) =>
      mounted.current ? context.confirm(owner, input) : Promise.resolve(false),
    [context, owner],
  );
}

const styles = StyleSheet.create((theme) => ({
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  actions: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  action: {
    flex: 1,
  },
  compactActions: {
    flexDirection: "column",
  },
}));
