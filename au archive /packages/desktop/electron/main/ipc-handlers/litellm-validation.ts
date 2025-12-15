/**
 * LiteLLM & Credentials Validation Schemas
 *
 * Zod validation for all LiteLLM-related IPC inputs.
 * Per audit requirement: Validate all IPC inputs to prevent injection.
 *
 * @version 1.0
 * @see docs/plans/litellm-plan-audit.md - Addition A
 */

import { z } from 'zod';

// =============================================================================
// CREDENTIAL SCHEMAS
// =============================================================================

/**
 * Valid cloud LLM provider identifiers
 */
export const ProviderIdSchema = z.enum(['anthropic', 'openai', 'google', 'groq']);

export type ProviderId = z.infer<typeof ProviderIdSchema>;

/**
 * API key validation
 * - Minimum 10 characters (shortest valid keys)
 * - Maximum 200 characters (generous upper bound)
 * - No whitespace
 */
export const ApiKeySchema = z
  .string()
  .min(10, 'API key is too short (minimum 10 characters)')
  .max(200, 'API key is too long (maximum 200 characters)')
  .refine((key) => !key.includes(' '), 'API key cannot contain spaces')
  .refine((key) => !key.includes('\n'), 'API key cannot contain newlines');

/**
 * Store credential request
 */
export const StoreCredentialSchema = z.object({
  provider: ProviderIdSchema,
  apiKey: ApiKeySchema,
});

export type StoreCredentialInput = z.infer<typeof StoreCredentialSchema>;

// =============================================================================
// LITELLM SCHEMAS
// =============================================================================

/**
 * Model name validation for testing
 */
export const ModelNameSchema = z
  .string()
  .min(1, 'Model name is required')
  .max(100, 'Model name too long');

/**
 * Test model request
 */
export const TestModelSchema = z.object({
  model: ModelNameSchema,
});

export type TestModelInput = z.infer<typeof TestModelSchema>;

/**
 * LiteLLM settings update
 */
export const LiteLLMSettingsSchema = z.object({
  port: z.coerce.number().int().min(1024).max(65535).optional(),
  routingStrategy: z.enum(['simple-shuffle', 'least-busy', 'cost-based-routing']).optional(),
  retries: z.coerce.number().int().min(0).max(10).optional(),
  cacheEnabled: z.boolean().optional(),
  idleTimeoutMinutes: z.coerce.number().int().min(1).max(60).optional(),
});

export type LiteLLMSettingsInput = z.infer<typeof LiteLLMSettingsSchema>;

// =============================================================================
// PRIVACY SCHEMAS
// =============================================================================

/**
 * Privacy settings update
 */
export const PrivacySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  redactGps: z.boolean().optional(),
  redactAddresses: z.boolean().optional(),
  excludedLocationIds: z.array(z.string()).optional(),
});

export type PrivacySettingsInput = z.infer<typeof PrivacySettingsSchema>;

// =============================================================================
// LLM RESPONSE SCHEMAS
// =============================================================================

/**
 * Date category from extraction
 */
export const DateCategorySchema = z.enum([
  'build_date',
  'opening',
  'closure',
  'demolition',
  'visit',
  'publication',
  'renovation',
  'event',
  'unknown',
]);

/**
 * Extracted date from LLM response
 */
export const ExtractedDateResponseSchema = z.object({
  rawText: z.string(),
  parsedDate: z.string().nullable(),
  parsedDateEnd: z.string().nullable().optional(),
  category: DateCategorySchema,
  confidence: z.number().min(0).max(1),
  verb: z.string().optional(),
  context: z.string().optional(),
  isApproximate: z.boolean().optional().default(false),
});

/**
 * Extracted person from LLM response
 */
export const ExtractedPersonResponseSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  confidence: z.number().min(0).max(1),
  mentions: z.array(z.string()).optional().default([]),
});

/**
 * Extracted organization from LLM response
 */
export const ExtractedOrgResponseSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  confidence: z.number().min(0).max(1),
  mentions: z.array(z.string()).optional().default([]),
});

/**
 * Full LLM extraction response validation
 */
export const LiteLLMResponseSchema = z.object({
  dates: z.array(ExtractedDateResponseSchema).optional().default([]),
  people: z.array(ExtractedPersonResponseSchema).optional().default([]),
  organizations: z.array(ExtractedOrgResponseSchema).optional().default([]),
  summary: z.string().optional(),
  title: z.string().optional(),
});

export type LiteLLMResponse = z.infer<typeof LiteLLMResponseSchema>;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Validate and parse store credential input.
 * Throws ZodError if validation fails.
 */
export function validateStoreCredential(input: unknown): StoreCredentialInput {
  return StoreCredentialSchema.parse(input);
}

/**
 * Validate and parse LLM response.
 * Returns parsed data with defaults applied.
 */
export function validateLiteLLMResponse(input: unknown): LiteLLMResponse {
  return LiteLLMResponseSchema.parse(input);
}

/**
 * Safe validate - returns result object instead of throwing.
 */
export function safeValidateCredential(
  input: unknown
): { success: true; data: StoreCredentialInput } | { success: false; error: string } {
  const result = StoreCredentialSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.errors[0]?.message || 'Validation failed' };
}
