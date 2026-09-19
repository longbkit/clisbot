// Settings → Instance settings: what the Hub operator sets up once for the whole
// Hub, such as the Slack and GitHub Apps organizations install. Hidden from
// everyone else (the sidebar lists it only for the operator).

import { ProviderApplicationSettings } from "./provider-application-settings";

export function InstanceSettings() {
  return <ProviderApplicationSettings />;
}
