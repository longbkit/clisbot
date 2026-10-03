import { Redirect } from "expo-router";

// WebBrowser owns validation and consumption of the fragment handoff. This
// landing route neither reads nor logs tokens when the OS brings the app back.
export default function HubGoogleCallback() {
  return <Redirect href="/settings/hub/account" />;
}
