import { Redirect } from "expo-router";

// WebBrowser owns the pending PKCE transaction and grant exchange. The router
// also receives the native URL; never render or consume its credentials here.
export default function HubAuthCallback() {
  return <Redirect href="/settings/hub/account" />;
}
