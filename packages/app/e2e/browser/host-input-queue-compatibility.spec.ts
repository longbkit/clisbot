import { registerSessionQueueCompatibility } from "../support/helpers/queue-compatibility";
import { registerChatQueueCompatibility } from "../support/helpers/chat-queue-compatibility";

registerChatQueueCompatibility();
registerSessionQueueCompatibility("legacy");
