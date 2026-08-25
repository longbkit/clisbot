import { z } from "zod";

export const projectSlugSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
    "must contain only lowercase letters, numbers, and single hyphens",
  )
  .max(100);
