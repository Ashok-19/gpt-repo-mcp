import { z } from "zod";

const KaggleToolSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  input_schema: z.record(z.string(), z.unknown()).optional(),
  output_schema: z.record(z.string(), z.unknown()).optional(),
  annotations: z.record(z.string(), z.unknown()).optional()
});

export const KaggleListToolsInputSchema = z.object({
  tool_name: z.string().min(1).optional(),
  cursor: z.string().min(1).optional()
});

export const KaggleListToolsResultSchema = z.object({
  tools: z.array(KaggleToolSchema),
  next_cursor: z.string().optional()
});

export const KaggleCallToolInputSchema = z.object({
  tool_name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({})
});

export const KaggleCallToolResultSchema = z.object({}).passthrough();

export type KaggleListToolsInput = z.infer<typeof KaggleListToolsInputSchema>;
export type KaggleCallToolInput = z.infer<typeof KaggleCallToolInputSchema>;
