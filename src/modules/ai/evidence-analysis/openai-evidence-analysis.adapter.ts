import { z } from 'zod';
import {
  buildOpenAiSafetyIdentifier,
  getOpenAiClient,
  mapOpenAiRuntimeError,
} from '../openai-client';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import { evidenceDocumentTypes, validateEvidenceAnalysisOutput } from './evidence-analysis.schema';
import type {
  EvidenceAnalysisProvider,
  EvidenceDocumentAnalysisInput,
  EvidenceDocumentAnalysisResult,
} from './evidence-analysis.types';
import { buildEvidenceCardPrompt } from './prompts/evidence-card-v1.prompt';

type ResponsesCreateParams = {
  model: string;
  store: boolean;
  input: Array<{
    role: 'developer' | 'user';
    content: Array<
      | { type: 'input_text'; text: string }
      | { type: 'input_image'; image_url: string; detail: 'auto' }
      | { type: 'input_file'; filename: string; file_data: string }
    >;
  }>;
  text: {
    format: {
      type: 'json_schema';
      name: string;
      strict: true;
      schema: Record<string, unknown>;
    };
  };
  max_output_tokens: number;
  reasoning?: { effort: 'minimal' };
  safety_identifier?: string;
  metadata: Record<string, string>;
};

type ResponsesCreateOptions = {
  timeout: number;
  maxRetries: number;
};

type OpenAiResponsesClient = {
  responses: {
    create(
      params: ResponsesCreateParams,
      options: ResponsesCreateOptions,
    ): Promise<unknown>;
  };
};

export type OpenAiEvidenceAnalysisConfig = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  storeResponses: boolean;
  promptVersion: string;
};

export class OpenAiEvidenceAnalysisAdapter implements EvidenceAnalysisProvider {
  readonly provider = 'openai' as const;
  private readonly client: OpenAiResponsesClient;

  constructor(
    private readonly config: OpenAiEvidenceAnalysisConfig,
    client?: OpenAiResponsesClient,
  ) {
    this.client = client ?? (getOpenAiClient() as unknown as OpenAiResponsesClient);
  }

  async analyze(input: EvidenceDocumentAnalysisInput): Promise<EvidenceDocumentAnalysisResult> {
    const startedAt = Date.now();
    const requestId = `evidence-${input.evidenceId}-${Date.now()}`;
    try {
      const response = await this.client.responses.create(
        this.buildRequest(input, requestId),
        { timeout: this.config.timeoutMs, maxRetries: this.config.maxRetries },
      );
      const output = parseResponseOutput(response);
      const parsed = validateEvidenceAnalysisOutput(
        output,
        'openai',
        this.config.model,
        this.config.promptVersion,
      );
      return {
        ...parsed,
        requestId,
        latencyMs: Date.now() - startedAt,
        usage: parseUsage(response),
      };
    } catch (error) {
      throw mapOpenAiError(error);
    }
  }

  private buildRequest(input: EvidenceDocumentAnalysisInput, requestId: string): ResponsesCreateParams {
    return {
      model: this.config.model,
      store: this.config.storeResponses,
      input: [
        {
          role: 'developer',
          content: [{ type: 'input_text', text: buildEvidenceCardPrompt() }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                `Evidence name: ${input.evidenceName}`,
                `Selected criterion: ${input.selectedCriterion}`,
                `Filename: ${input.filename}`,
                `MIME type: ${input.mimeType}`,
                input.studentContext?.fullName
                  ? `Student full name for comparison only: ${input.studentContext.fullName}`
                  : null,
                input.studentContext?.studentCode
                  ? `Student code for comparison only: ${input.studentContext.studentCode}`
                  : null,
              ]
                .filter(Boolean)
                .join('\n'),
            },
            buildFileInput(input),
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'evidence_card_extraction',
          strict: true,
          schema: zodToJsonSchema(),
        },
      },
      max_output_tokens: 4000,
      reasoning: { effort: 'minimal' },
      safety_identifier: buildOpenAiSafetyIdentifier('evidence', input.evidenceId),
      metadata: {
        requestId,
        evidenceId: input.evidenceId,
        evidenceFileId: input.evidenceFileId,
        fileId: input.fileId,
        promptVersion: this.config.promptVersion,
      },
    };
  }
}

function buildFileInput(input: EvidenceDocumentAnalysisInput) {
  const base64 = input.fileBuffer.toString('base64');
  if (input.mimeType.startsWith('image/')) {
    return {
      type: 'input_image' as const,
      image_url: `data:${input.mimeType};base64,${base64}`,
      detail: 'auto' as const,
    };
  }
  if (input.mimeType === 'application/pdf') {
    return {
      type: 'input_file' as const,
      filename: input.filename,
      file_data: `data:${input.mimeType};base64,${base64}`,
    };
  }
  throw new AppError(415, ErrorCodes.UNSUPPORTED_EVIDENCE_FILE, 'Unsupported evidence file type', {
    retryable: false,
  });
}

function parseResponseOutput(response: unknown) {
  const record = asRecord(response);
  if (hasRefusal(record)) {
    throw new AppError(422, ErrorCodes.OPENAI_REFUSED, 'OpenAI refused to analyze the document', {
      retryable: false,
    });
  }
  const outputText = typeof record?.output_text === 'string' ? record.output_text : undefined;
  if (!outputText?.trim()) {
    throw new AppError(502, ErrorCodes.OPENAI_INVALID_OUTPUT, 'OpenAI response did not include structured output', {
      retryable: false,
    });
  }
  try {
    return JSON.parse(outputText) as unknown;
  } catch {
    throw new AppError(502, ErrorCodes.OPENAI_INVALID_OUTPUT, 'OpenAI structured output was not valid JSON', {
      retryable: false,
    });
  }
}

function mapOpenAiError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError) {
    return new AppError(502, ErrorCodes.OPENAI_INVALID_OUTPUT, 'OpenAI structured output failed validation', {
      retryable: false,
      issues: error.issues.map((issue) => ({ path: issue.path, code: issue.code })),
    });
  }
  const record = asRecord(error);
  const status = typeof record?.status === 'number' ? record.status : undefined;
  const name = typeof record?.name === 'string' ? record.name : '';
  const message = typeof record?.message === 'string' ? record.message : 'OpenAI evidence analysis failed';
  if (name === 'AbortError' || message.toLowerCase().includes('timeout')) {
    return new AppError(504, ErrorCodes.OPENAI_TIMEOUT, 'OpenAI evidence analysis timed out', {
      retryable: true,
    });
  }
  if (status === 429) {
    return new AppError(429, ErrorCodes.OPENAI_RATE_LIMITED, 'OpenAI evidence analysis was rate limited', {
      retryable: true,
    });
  }
  const code = mapOpenAiRuntimeError(error, ErrorCodes.EVIDENCE_ANALYSIS_FAILED);
  return new AppError(502, code, 'Evidence analysis failed', {
    retryable: status === undefined || status >= 500,
  });
}

function parseUsage(response: unknown) {
  const usage = asRecord(asRecord(response)?.usage);
  if (!usage) return undefined;
  return {
    inputTokens: numberValue(usage.input_tokens),
    outputTokens: numberValue(usage.output_tokens),
    totalTokens: numberValue(usage.total_tokens),
  };
}

function hasRefusal(record: Record<string, unknown> | undefined) {
  const output = record?.output;
  return Array.isArray(output) && output.some((item) => asRecord(item)?.type === 'refusal');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function numberValue(value: unknown) {
  return typeof value === 'number' ? value : undefined;
}

function zodToJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'documentType',
      'fields',
      'documentFacts',
      'suggestedCriteria',
      'documentPrecheck',
      'warnings',
      'summary',
      'overallConfidence',
      'requiresHumanConfirmation',
    ],
    properties: {
      documentType: {
        type: 'string',
        enum: [...evidenceDocumentTypes],
      },
      fields: evidenceFieldsJsonSchema(),
      documentFacts: documentFactsJsonSchema(),
      suggestedCriteria: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterion', 'confidence', 'reason'],
          properties: {
            criterion: { type: 'string', enum: ['ethics', 'academic', 'physical', 'volunteer', 'integration', 'priority', 'collective'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            reason: { type: 'string' },
          },
        },
      },
      documentPrecheck: documentPrecheckJsonSchema(),
      warnings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'severity', 'field', 'message'],
          properties: {
            code: { type: 'string' },
            severity: { type: 'string', enum: ['info', 'warning', 'blocking'] },
            field: {
              type: ['string', 'null'],
              enum: [
                'student_name',
                'student_code',
                'class_name',
                'faculty',
                'event_name',
                'organizer',
                'organizer_level',
                'issue_date',
                'activity_date',
                'award_level',
                'volunteer_days',
                'certificate_type',
                'language_score',
                'gpa',
                'conduct_score',
                null,
              ],
            },
            message: { type: 'string' },
          },
        },
      },
      summary: { type: 'string' },
      overallConfidence: { type: 'number', minimum: 0, maximum: 1 },
      requiresHumanConfirmation: { type: 'boolean' },
    },
  };
}

function documentFactsJsonSchema() {
  const nullableText = { type: ['string', 'null'] };
  const nullableNumber = { type: ['number', 'null'] };
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'documentTitle',
      'identity',
      'activity',
      'organization',
      'conductEntries',
      'fitness',
      'language',
      'award',
      'academic',
    ],
    properties: {
      documentTitle: nullableText,
      identity: {
        type: 'object',
        additionalProperties: false,
        required: ['studentName', 'studentCode', 'schoolName'],
        properties: {
          studentName: nullableText,
          studentCode: nullableText,
          schoolName: nullableText,
        },
      },
      activity: {
        type: 'object',
        additionalProperties: false,
        required: ['eventName', 'programName', 'location', 'activityDate'],
        properties: {
          eventName: nullableText,
          programName: nullableText,
          location: nullableText,
          activityDate: nullableText,
        },
      },
      organization: {
        type: 'object',
        additionalProperties: false,
        required: ['issuerName', 'issuerLevel'],
        properties: {
          issuerName: nullableText,
          issuerLevel: nullableText,
        },
      },
      conductEntries: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['semester', 'schoolYear', 'score', 'classification'],
          properties: {
            semester: nullableText,
            schoolYear: nullableText,
            score: nullableNumber,
            classification: nullableText,
          },
        },
      },
      fitness: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'resultLevel', 'sportName'],
        properties: {
          title: nullableText,
          resultLevel: nullableText,
          sportName: nullableText,
        },
      },
      language: {
        type: 'object',
        additionalProperties: false,
        required: ['certificateType', 'score', 'frameworkLevel'],
        properties: {
          certificateType: nullableText,
          score: nullableNumber,
          frameworkLevel: nullableText,
        },
      },
      award: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'rank', 'level'],
        properties: {
          title: nullableText,
          rank: nullableText,
          level: nullableText,
        },
      },
      academic: {
        type: 'object',
        additionalProperties: false,
        required: ['gpa', 'gpaScale', 'hasFGrade'],
        properties: {
          gpa: nullableNumber,
          gpaScale: nullableNumber,
          hasFGrade: { type: ['boolean', 'null'] },
        },
      },
    },
  };
}

function documentPrecheckJsonSchema() {
  const fieldEnum = [
    'student_name',
    'student_code',
    'class_name',
    'faculty',
    'event_name',
    'organizer',
    'organizer_level',
    'issue_date',
    'activity_date',
    'award_level',
    'volunteer_days',
    'certificate_type',
    'language_score',
    'gpa',
    'conduct_score',
  ];
  const criterionEnum = [
    'ethics',
    'academic',
    'physical',
    'volunteer',
    'integration',
    'priority',
    'collective',
  ];
  return {
    type: 'object',
    additionalProperties: false,
    required: ['identifiedAs', 'completeness', 'quality', 'relevance'],
    properties: {
      identifiedAs: {
        type: 'object',
        additionalProperties: false,
        required: ['documentLabel', 'shortDescription'],
        properties: {
          documentLabel: { type: 'string' },
          shortDescription: { type: 'string' },
        },
      },
      completeness: {
        type: 'object',
        additionalProperties: false,
        required: ['score', 'availableFields', 'missingImportantFields'],
        properties: {
          score: { type: 'number', minimum: 0, maximum: 1 },
          availableFields: { type: 'array', items: { type: 'string', enum: fieldEnum } },
          missingImportantFields: { type: 'array', items: { type: 'string', enum: fieldEnum } },
        },
      },
      quality: {
        type: 'object',
        additionalProperties: false,
        required: ['level', 'issues'],
        properties: {
          level: { type: 'string', enum: ['clear', 'needs_check', 'poor'] },
          issues: {
            type: 'array',
            items: {
              type: 'string',
              enum: [
                'blurred',
                'cropped',
                'low_resolution',
                'handwriting_unclear',
                'multiple_documents',
                'page_missing',
              ],
            },
          },
        },
      },
      relevance: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterion', 'level', 'explanation'],
          properties: {
            criterion: { type: 'string', enum: criterionEnum },
            level: { type: 'string', enum: ['strong', 'possible', 'unclear'] },
            explanation: { type: 'string' },
          },
        },
      },
    },
  };
}

function evidenceFieldsJsonSchema() {
  const textField = fieldJsonSchema(['string', 'null']);
  const numberField = fieldJsonSchema(['number', 'null']);
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'student_name',
      'student_code',
      'class_name',
      'faculty',
      'event_name',
      'organizer',
      'organizer_level',
      'issue_date',
      'activity_date',
      'award_level',
      'volunteer_days',
      'certificate_type',
      'language_score',
      'gpa',
      'conduct_score',
    ],
    properties: {
      student_name: textField,
      student_code: textField,
      class_name: textField,
      faculty: textField,
      event_name: textField,
      organizer: textField,
      organizer_level: {
        ...fieldJsonSchema(['string', 'null']),
        properties: {
          ...fieldJsonSchema(['string', 'null']).properties,
          value: {
            type: ['string', 'null'],
            enum: [
              'class',
              'faculty',
              'school',
              'university',
              'city',
              'central',
              'club',
              'external',
              'unknown',
              null,
            ],
          },
        },
      },
      issue_date: textField,
      activity_date: textField,
      award_level: textField,
      volunteer_days: numberField,
      certificate_type: textField,
      language_score: numberField,
      gpa: numberField,
      conduct_score: numberField,
    },
  };
}

function fieldJsonSchema(valueType: Array<'string' | 'number' | 'null'>) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['value', 'confidence', 'source'],
    properties: {
      value: { type: valueType },
      confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
      source: { type: 'string', enum: ['openai', 'smartreader', 'mock', 'event_registry'] },
    },
  };
}
