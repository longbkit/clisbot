// upstream: extensions/whatsapp/src/account-ids.ts@3928bad9bad
// Whatsapp plugin module implements account ids behavior.
import { createAccountListHelpers } from "@clisbot/channels-core/plugin-sdk/account-core";

const {
  listConfiguredAccountIds,
  listAccountIds,
  resolveDefaultAccountId: resolveDefaultWhatsAppAccountId,
} = createAccountListHelpers("whatsapp", {
  implicitDefaultAccount: {
    channelKeys: ["authDir"],
  },
});

export {
  listConfiguredAccountIds,
  listAccountIds as listWhatsAppAccountIds,
  resolveDefaultWhatsAppAccountId,
};
