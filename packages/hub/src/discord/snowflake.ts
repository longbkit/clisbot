import { z } from "zod";

export const DiscordSnowflakeSchema = z.string().regex(/^[1-9]\d*$/u);
