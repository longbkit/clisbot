import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const ChatOptionsContext = createContext<{
  visible: boolean;
  setVisible: (visible: boolean) => void;
} | null>(null);

export function ChatOptionsProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const value = useMemo(() => ({ visible, setVisible }), [visible]);
  return <ChatOptionsContext.Provider value={value}>{children}</ChatOptionsContext.Provider>;
}

export function useChatOptionsState() {
  const context = useContext(ChatOptionsContext);
  if (!context) throw new Error("Chat options requires ChatOptionsProvider");
  return context;
}
