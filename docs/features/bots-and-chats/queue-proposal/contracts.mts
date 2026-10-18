/** Minimal Host queue contract. Production schema owners are imported, never copied. */
import { z } from "zod";
import {
  QueueSnapshotSchema,
  QueueItemSchema,
} from "../../../../packages/server/src/server/input-queue/input-queue-store.js";
import { StoredQueueContentSchema } from "../../../../packages/server/src/server/input-queue/content.js";
export {
  InputQueueCommandSchema as Command,
  InputQueueViewSchema as Response,
} from "../../../../packages/protocol/src/input-queue.js";
export const Content = StoredQueueContentSchema;
export const Record = QueueSnapshotSchema.extend({
  items: z.array(QueueItemSchema.extend({ payload: Content })).max(32),
});
