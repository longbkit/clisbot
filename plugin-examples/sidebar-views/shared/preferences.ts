import { defineSettings } from "@clisbot/plugin";
import { z } from "zod";
export const folders = defineSettings({
  id: "folders",
  scope: "device",
  version: 1,
  schema: z.object({ collapsed: z.array(z.string()).default([]) }),
});
