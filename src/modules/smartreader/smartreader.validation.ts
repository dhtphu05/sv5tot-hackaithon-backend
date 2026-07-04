import { z } from 'zod';

export const smartReaderFileInputSchema = z.object({
  filePath: z.string().min(1).optional(),
  fileId: z.string().uuid().optional(),
  hash: z.string().min(1).optional(),
  fileHash: z.string().min(1).optional(),
  fileType: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});

export const smartReaderDebugQuerySchema = z.object({
  debug: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .default('false'),
});
