export type HubAccountEntryMode =
  | "signIn"
  | "signUp"
  | "instanceSetup"
  | "passwordChange"
  | "organization"
  | "account";
export type HubAccountEntryField =
  | "name"
  | "email"
  | "password"
  | "confirmPassword"
  | "currentPassword"
  | "organizationName";

const EMPTY_FIELDS: Record<HubAccountEntryField, string> = {
  name: "",
  email: "",
  password: "",
  confirmPassword: "",
  currentPassword: "",
  organizationName: "",
};

export function openHubAccountEntryForm(snapshot: {
  mode: HubAccountEntryMode;
  invitedEmail?: string;
}) {
  let fields = { ...EMPTY_FIELDS, email: snapshot.invitedEmail ?? "" };
  let mode = snapshot.mode;
  const listeners = new Set<() => void>();
  let state = derive();
  function derive() {
    const passwordsMatch = fields.password === fields.confirmPassword;
    return {
      ...fields,
      mode,
      passwordsMatch,
      canSubmit: canSubmitAccountEntry(mode, fields, passwordsMatch),
    };
  }
  function publish() {
    state = derive();
    listeners.forEach((listener) => listener());
  }
  function setField(field: HubAccountEntryField, value: string) {
    fields = { ...fields, [field]: value };
    publish();
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      listeners.clear();
    },
    setName: (value: string) => setField("name", value),
    setEmail: (value: string) => setField("email", value),
    setPassword: (value: string) => setField("password", value),
    setConfirmPassword: (value: string) => setField("confirmPassword", value),
    setCurrentPassword: (value: string) => setField("currentPassword", value),
    setOrganizationName: (value: string) => setField("organizationName", value),
    setEntryMode(next: "signIn" | "signUp") {
      if (next === mode) return;
      mode = next;
      // Email/password are shared input; fields hidden by the next mode start fresh.
      fields = { ...fields, name: "", confirmPassword: "" };
      publish();
    },
  };
}

function canSubmitAccountEntry(
  mode: HubAccountEntryMode,
  fields: Record<HubAccountEntryField, string>,
  passwordsMatch: boolean,
): boolean {
  if (mode === "organization") return fields.organizationName.trim().length > 0;
  if (mode === "account") return false;
  if (mode === "signIn") return fields.email.trim().length > 0 && fields.password.length > 0;
  const validPassword = fields.password.length >= 12 && passwordsMatch;
  if (mode === "passwordChange") return fields.currentPassword.length > 0 && validPassword;
  return (
    fields.email.trim().length > 0 &&
    validPassword &&
    (mode !== "signUp" || fields.name.trim().length > 0)
  );
}
