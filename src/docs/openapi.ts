import packageJson from '../../package.json';

const bearerSecurity = [{ bearerAuth: [] }];

const jsonResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiResponse' },
    },
  },
});

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: '5TOT Backend API',
    version: packageJson.version,
  },
  tags: [
    { name: 'Health' },
    { name: 'Version' },
    { name: 'Auth' },
    { name: 'Users' },
    { name: 'Applications' },
    { name: 'Metrics' },
    { name: 'Evidences' },
    { name: 'Event Registry' },
    { name: 'Knowledge Base' },
    { name: 'Precheck' },
    { name: 'Cascade' },
    { name: 'Review' },
    { name: 'Manager' },
    { name: 'Collective' },
    { name: 'Resolution' },
    { name: 'Notifications' },
    { name: 'Audit' },
    { name: 'AI' },
    { name: 'SmartUX' },
    { name: 'Exports' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      ApiResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { nullable: true },
          error: { nullable: true },
          meta: { type: 'object' },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', example: 'student@dut.udn.vn' },
          password: { type: 'string', example: 'Password@123' },
        },
      },
      RegisterRequest: {
        type: 'object',
        required: ['fullName', 'email', 'password', 'studentCode'],
        properties: {
          fullName: { type: 'string', example: 'Nguyen Van A' },
          email: { type: 'string', example: 'student.new@dut.udn.vn' },
          password: { type: 'string', example: 'Password@123' },
          studentCode: { type: 'string', example: '21IT999' },
          className: { type: 'string', example: '21TCLC_DT1' },
          faculty: { type: 'string', example: 'Cong nghe thong tin' },
          phone: { type: 'string', example: '0901234567' },
        },
      },
      RefreshRequest: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string' },
        },
      },
      UpdateMeRequest: {
        type: 'object',
        properties: {
          fullName: { type: 'string' },
          phone: { type: 'string', nullable: true },
          avatarUrl: { type: 'string', nullable: true },
        },
      },
      StartApplicationRequest: {
        type: 'object',
        properties: {
          schoolYear: { type: 'string', example: '2025-2026' },
          targetLevel: { type: 'string', enum: ['school', 'university', 'city', 'central'] },
        },
      },
      UpdateTargetLevelRequest: {
        type: 'object',
        required: ['targetLevel'],
        properties: {
          targetLevel: { type: 'string', enum: ['school', 'university', 'city', 'central'] },
        },
      },
      SubmitApplicationRequest: {
        type: 'object',
        properties: {
          allowSubmitWithWarnings: { type: 'boolean', default: false },
          studentNote: { type: 'string' },
        },
      },
      ReviewTaskDecisionRequest: {
        type: 'object',
        required: ['decision'],
        properties: {
          decision: {
            type: 'string',
            enum: ['accepted', 'rejected', 'supplement_required', 'resolution_needed'],
          },
          officerNote: { type: 'string' },
          evidenceDecisions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                evidenceId: { type: 'string' },
                status: { type: 'string', example: 'accepted' },
                note: { type: 'string' },
              },
            },
          },
        },
      },
      RunPrecheckRequest: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['school', 'university', 'city', 'central'] },
          runMode: { type: 'string', enum: ['sync'] },
        },
      },
      RunCascadeReviewRequest: {
        type: 'object',
        properties: {
          includeUpgradeHints: { type: 'boolean', default: false },
        },
      },
      CriterionResult: {
        type: 'object',
        properties: {
          criterion: { type: 'string', example: 'volunteer' },
          status: {
            type: 'string',
            enum: ['passed', 'failed', 'missing', 'human_review_required'],
          },
          score: { type: 'number', example: 60 },
          requiredItems: { type: 'array', items: { type: 'string' } },
          matchedItems: { type: 'array', items: { type: 'string' } },
          missingItems: { type: 'array', items: { type: 'string' } },
          warnings: { type: 'array', items: { type: 'string' } },
          explanation: { type: 'string' },
          evidenceRefs: { type: 'array', items: { type: 'string' } },
          metricRefs: { type: 'array', items: { type: 'string' } },
        },
      },
      UpsertMetricRequest: {
        type: 'object',
        required: ['metricType', 'value'],
        properties: {
          metricType: {
            type: 'string',
            enum: [
              'gpa',
              'conduct_score',
              'physical_score',
              'volunteer_days',
              'foreign_language_score',
            ],
          },
          value: { type: 'number', example: 3.45 },
          scale: { oneOf: [{ type: 'string' }, { type: 'number' }], example: '4.0' },
        },
      },
      CreateEvidenceRequest: {
        type: 'object',
        required: ['evidenceName', 'criterion'],
        properties: {
          evidenceName: { type: 'string', example: 'Giấy chứng nhận Mùa hè xanh 2025' },
          criterion: {
            type: 'string',
            enum: ['ethics', 'academic', 'physical', 'volunteer', 'integration', 'priority'],
          },
          sourceType: { type: 'string', enum: ['manual_upload'], default: 'manual_upload' },
        },
      },
      CreateEventRequest: {
        type: 'object',
        required: ['eventName', 'criterion', 'organizer', 'organizerLevel'],
        properties: {
          eventName: { type: 'string', example: 'Chiến dịch Mùa hè xanh 2025' },
          criterion: {
            type: 'string',
            enum: ['ethics', 'academic', 'physical', 'volunteer', 'integration', 'priority'],
          },
          organizer: { type: 'string', example: 'Đoàn Thanh niên - Hội Sinh viên Trường' },
          organizerLevel: { type: 'string', enum: ['school', 'university', 'city', 'central'] },
          convertedValue: { type: 'number', example: 3 },
          convertedUnit: { type: 'string', example: 'days' },
          eligibleLevels: {
            type: 'array',
            items: { type: 'string', enum: ['school', 'university', 'city', 'central'] },
          },
        },
      },
      ConfirmRosterRequest: {
        type: 'object',
        required: ['columnMapping'],
        properties: {
          eventFileId: { type: 'string' },
          replaceExisting: { type: 'boolean', default: true },
          columnMapping: {
            type: 'object',
            example: {
              studentCode: 'MSSV',
              studentName: 'Họ và tên',
              className: 'Lớp',
              faculty: 'Khoa',
              participationStatus: 'Trạng thái',
              convertedValue: 'Số ngày',
            },
          },
        },
      },
      StartCollectiveRequest: {
        type: 'object',
        properties: {
          schoolYear: { type: 'string', example: '2025-2026' },
          className: { type: 'string', example: '22T_DT1' },
          targetLevel: { type: 'string', enum: ['school', 'university', 'city', 'central'] },
        },
      },
      CollectiveMemberRequest: {
        type: 'object',
        required: ['studentCode', 'studentName'],
        properties: {
          studentCode: { type: 'string', example: '102220001' },
          studentName: { type: 'string', example: 'Nguyễn Văn Sinh' },
          className: { type: 'string' },
          faculty: { type: 'string' },
          participationStatus: {
            type: 'string',
            enum: ['participated', 'not_participated', 'unknown'],
          },
          individualSv5tLevel: {
            type: 'string',
            enum: ['none', 'school', 'university', 'city', 'central', 'unknown'],
          },
          violationStatus: { type: 'string', enum: ['none', 'violated', 'unknown'] },
          note: { type: 'string' },
        },
      },
      CollectiveEvidenceRequest: {
        type: 'object',
        required: ['evidenceName', 'collectiveCriterion'],
        properties: {
          evidenceName: { type: 'string' },
          criterion: { type: 'string', enum: ['collective'], default: 'collective' },
          collectiveCriterion: {
            type: 'string',
            example: 'participation_rate',
          },
          sourceType: {
            type: 'string',
            enum: ['manual_upload', 'collective_import'],
            default: 'manual_upload',
          },
        },
      },
      FinalizeCollectiveRequest: {
        type: 'object',
        required: ['finalStatus', 'finalNote'],
        properties: {
          finalStatus: { type: 'string', enum: ['passed', 'failed', 'partially_passed'] },
          finalLevel: {
            type: 'string',
            nullable: true,
            enum: ['school', 'university', 'city', 'central'],
          },
          finalNote: { type: 'string' },
          overrideAggregation: { type: 'boolean', default: false },
          notifyRepresentative: { type: 'boolean', default: true },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        responses: { '200': jsonResponse('API is healthy') },
      },
    },
    '/api/version': {
      get: {
        tags: ['Version'],
        summary: 'API version',
        responses: { '200': jsonResponse('API version metadata') },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email and password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginRequest' },
            },
          },
        },
        responses: {
          '200': jsonResponse('Safe user, access token, and refresh token'),
          '401': jsonResponse('Invalid credentials'),
          '403': jsonResponse('Inactive user'),
        },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a student account',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RegisterRequest' },
            },
          },
        },
        responses: {
          '201': jsonResponse('Safe user, access token, and refresh token'),
          '400': jsonResponse('Validation failed'),
          '409': jsonResponse('Email or student code already exists'),
        },
      },
    },
    '/api/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate refresh token and issue a new access token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RefreshRequest' },
            },
          },
        },
        responses: {
          '200': jsonResponse('New access and refresh tokens'),
          '401': jsonResponse('Invalid or expired refresh token'),
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Revoke current or all active refresh tokens',
        security: bearerSecurity,
        responses: {
          '200': jsonResponse('Logout completed'),
          '401': jsonResponse('Missing or invalid access token'),
        },
      },
    },
    '/api/me': {
      get: {
        tags: ['Users'],
        summary: 'Get current authenticated user',
        security: bearerSecurity,
        responses: {
          '200': jsonResponse('Current safe user'),
          '401': jsonResponse('Missing or invalid access token'),
        },
      },
      patch: {
        tags: ['Users'],
        summary: 'Update current user profile fields',
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateMeRequest' },
            },
          },
        },
        responses: {
          '200': jsonResponse('Updated safe user'),
          '401': jsonResponse('Missing or invalid access token'),
        },
      },
    },
    '/api/users': {
      get: {
        tags: ['Users'],
        summary: 'List users for manager, committee, and admin roles',
        security: bearerSecurity,
        parameters: [
          { in: 'query', name: 'role', schema: { type: 'string' } },
          { in: 'query', name: 'faculty', schema: { type: 'string' } },
          { in: 'query', name: 'q', schema: { type: 'string' } },
          { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          '200': jsonResponse('Paginated safe users'),
          '403': jsonResponse('Role is not allowed'),
        },
      },
    },
    '/api/applications/current': {
      get: {
        tags: ['Applications'],
        summary: 'Get the current individual application for a school year',
        security: bearerSecurity,
        parameters: [
          { in: 'query', name: 'schoolYear', schema: { type: 'string', example: '2025-2026' } },
        ],
        responses: {
          '200': jsonResponse('Current application or not_started state'),
          '401': jsonResponse('Missing or invalid access token'),
        },
      },
    },
    '/api/applications/current/start': {
      post: {
        tags: ['Applications'],
        summary: 'Idempotently start the current individual application',
        security: bearerSecurity,
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/StartApplicationRequest' },
            },
          },
        },
        responses: {
          '201': jsonResponse('Started or existing application'),
        },
      },
    },
    '/api/applications/{id}/target-level': {
      patch: {
        tags: ['Applications'],
        summary: 'Update application target level',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateTargetLevelRequest' },
            },
          },
        },
        responses: {
          '200': jsonResponse('Updated application'),
          '409': jsonResponse('Application is locked'),
        },
      },
    },
    '/api/applications/{id}/draft': {
      patch: {
        tags: ['Applications'],
        summary: 'Autosave current draft and create a versioned snapshot',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': jsonResponse('Draft autosave metadata'),
          '409': jsonResponse('Application is locked'),
        },
      },
    },
    '/api/applications/{id}/timeline': {
      get: {
        tags: ['Applications'],
        summary: 'Get application audit timeline',
        security: bearerSecurity,
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          '200': jsonResponse('Paginated audit timeline'),
        },
      },
    },
    '/api/applications/{id}/submit': {
      post: {
        tags: ['Applications'],
        summary: 'Submit an editable application with readiness warnings if explicitly allowed',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SubmitApplicationRequest' },
              example: { allowSubmitWithWarnings: true },
            },
          },
        },
        responses: {
          '200': jsonResponse('Submitted application. Phase 07 will create review tasks.'),
          '409': jsonResponse('Application is locked or not ready without warning override'),
        },
      },
    },
    '/api/applications/{id}/precheck': {
      post: {
        tags: ['Precheck'],
        summary: 'Run MVP rules/AI precheck for an application',
        description: 'Kết quả là gợi ý tiền kiểm, không phải quyết định xét duyệt cuối cùng.',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RunPrecheckRequest' },
              example: { level: 'city', runMode: 'sync' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Precheck result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiResponse' },
                example: {
                  success: true,
                  data: {
                    applicationId: 'uuid',
                    level: 'city',
                    readinessScore: 72,
                    readyToSubmit: false,
                    criteriaResults: [{ criterion: 'volunteer', status: 'failed', score: 0 }],
                    missingItems: [
                      {
                        criterion: 'volunteer',
                        code: 'MISSING_VOLUNTEER_DAYS',
                        message: 'Số ngày tình nguyện hiện chưa đạt ngưỡng 5 ngày.',
                        severity: 'blocking',
                        suggestedAction:
                          'Bổ sung minh chứng tình nguyện hoặc import sự kiện hợp lệ.',
                      },
                    ],
                    warnings: ['HUMAN_CONFIRMATION_REQUIRED'],
                    nextBestAction:
                      'Hồ sơ hiện chưa đủ dữ liệu tình nguyện cho cấp Thành phố; bạn có thể bổ sung thêm minh chứng hoặc cân nhắc xét cấp phù hợp hơn.',
                    humanConfirmationRequired: true,
                    createdAt: '2026-06-30T00:00:00.000Z',
                  },
                  error: null,
                  meta: { requestId: 'req-id' },
                },
              },
            },
          },
        },
      },
    },
    '/api/applications/{id}/precheck/latest': {
      get: {
        tags: ['Precheck'],
        summary: 'Get latest precheck result',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': jsonResponse('Latest precheck result or null'),
        },
      },
    },
    '/api/applications/{id}/cascade-review': {
      post: {
        tags: ['Cascade'],
        summary: 'Run cascade review from target level downward',
        description: 'Kết quả là gợi ý tiền kiểm, không phải quyết định xét duyệt cuối cùng.',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RunCascadeReviewRequest' },
              example: { includeUpgradeHints: true },
            },
          },
        },
        responses: {
          '201': {
            description: 'Cascade review result',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiResponse' },
                example: {
                  success: true,
                  data: {
                    applicationId: 'uuid',
                    targetLevel: 'city',
                    suggestedLevel: 'university',
                    humanConfirmationRequired: true,
                    levelResults: [
                      { level: 'city', status: 'missing', readinessScore: 58, missingItems: [] },
                      {
                        level: 'university',
                        status: 'human_review_required',
                        readinessScore: 70,
                        missingItems: [],
                      },
                    ],
                    upgradeHints: [],
                    nextBestAction:
                      'Hồ sơ hiện chưa đủ dữ liệu cho cấp Thành phố do thiếu số ngày tình nguyện.',
                  },
                  error: null,
                  meta: { requestId: 'req-id' },
                },
              },
            },
          },
        },
      },
    },
    '/api/applications/{id}/cascade-review/latest': {
      get: {
        tags: ['Cascade'],
        summary: 'Get latest cascade review result',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': jsonResponse('Latest cascade review result or null'),
        },
      },
    },
    '/api/applications/{id}/reopen-supplement': {
      post: {
        tags: ['Applications'],
        summary: 'Manager/admin reopens an application for supplement',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': jsonResponse('Application reopened for supplement'),
        },
      },
    },
    '/api/applications/{id}/metrics': {
      post: {
        tags: ['Metrics'],
        summary: 'Upsert an application metric',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpsertMetricRequest' },
            },
          },
        },
        responses: {
          '200': jsonResponse('Created or updated metric'),
          '400': jsonResponse('Invalid metric value'),
        },
      },
    },
    '/api/metrics/{metricId}': {
      patch: {
        tags: ['Metrics'],
        summary: 'Update metric value or verification status',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'metricId', required: true, schema: { type: 'string' } }],
        responses: {
          '200': jsonResponse('Updated metric'),
        },
      },
    },
    '/api/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'List current user notifications',
        security: bearerSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          '200': jsonResponse('Paginated notifications'),
        },
      },
    },
    '/api/notifications/{id}/read': {
      patch: {
        tags: ['Notifications'],
        summary: 'Mark a notification as read',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': jsonResponse('Updated notification'),
        },
      },
    },
    '/api/applications/{id}/evidences': {
      get: {
        tags: ['Evidences'],
        summary: 'List evidences for an application',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Paginated evidences') },
      },
      post: {
        tags: ['Evidences'],
        summary: 'Create manual-upload evidence',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateEvidenceRequest' },
            },
          },
        },
        responses: { '201': jsonResponse('Created evidence') },
      },
    },
    '/api/evidences/{id}': {
      patch: {
        tags: ['Evidences'],
        summary: 'Update evidence name or criterion',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Updated evidence') },
      },
      delete: {
        tags: ['Evidences'],
        summary: 'Delete editable evidence and its files',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Deleted evidence') },
      },
    },
    '/api/evidences/{id}/files': {
      post: {
        tags: ['Evidences'],
        summary: 'Upload a file for manual evidence and enqueue OCR job',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: {
                    type: 'string',
                    format: 'binary',
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': jsonResponse('Uploaded file and queued indexing job'),
          '400': jsonResponse('Invalid file'),
        },
      },
    },
    '/api/evidences/{id}/start-indexing': {
      post: {
        tags: ['Evidences'],
        summary: 'Start or reuse evidence OCR indexing job',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Indexing job and evidence status') },
      },
    },
    '/api/evidences/{id}/card': {
      get: {
        tags: ['Evidences'],
        summary: 'Get generated Evidence Card',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Evidence card or current indexing state') },
      },
    },
    '/api/jobs/{id}': {
      get: {
        tags: ['Jobs'],
        summary: 'Get indexing job status',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Job status') },
      },
    },
    '/api/jobs/{id}/run': {
      post: {
        tags: ['Jobs'],
        summary: 'Run indexing job synchronously',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Completed or failed job') },
      },
    },
    '/api/knowledge-base/search': {
      get: {
        tags: ['Knowledge Base'],
        summary: 'Search knowledge base by text and filters',
        security: bearerSecurity,
        parameters: [
          { in: 'query', name: 'q', schema: { type: 'string' } },
          { in: 'query', name: 'criterion', schema: { type: 'string' } },
          { in: 'query', name: 'level', schema: { type: 'string' } },
          { in: 'query', name: 'decision', schema: { type: 'string' } },
        ],
        responses: { '200': jsonResponse('Knowledge base search results') },
      },
    },
    '/api/events': {
      get: {
        tags: ['Event Registry'],
        summary: 'List events visible to current role',
        security: bearerSecurity,
        parameters: [
          { in: 'query', name: 'q', schema: { type: 'string' } },
          { in: 'query', name: 'criterion', schema: { type: 'string' } },
          { in: 'query', name: 'organizerLevel', schema: { type: 'string' } },
          { in: 'query', name: 'status', schema: { type: 'string' } },
        ],
        responses: { '200': jsonResponse('Paginated events') },
      },
      post: {
        tags: ['Event Registry'],
        summary: 'Create event registry item',
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateEventRequest' },
            },
          },
        },
        responses: { '201': jsonResponse('Created event') },
      },
    },
    '/api/events/{id}': {
      get: {
        tags: ['Event Registry'],
        summary: 'Get event detail',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Event detail') },
      },
      patch: {
        tags: ['Event Registry'],
        summary: 'Update event registry item',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Updated event') },
      },
    },
    '/api/events/{id}/roster-files': {
      post: {
        tags: ['Event Registry'],
        summary: 'Upload roster file and enqueue roster indexing job',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: { '201': jsonResponse('Uploaded roster file and queued job') },
      },
    },
    '/api/events/{id}/start-indexing': {
      post: {
        tags: ['Event Registry'],
        summary: 'Start roster indexing and optionally run sync',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Job, event file, and preview') },
      },
    },
    '/api/events/{id}/participants': {
      get: {
        tags: ['Event Registry'],
        summary: 'List confirmed participants or preview rows',
        security: bearerSecurity,
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'preview', schema: { type: 'boolean' } },
        ],
        responses: { '200': jsonResponse('Participants or preview rows') },
      },
    },
    '/api/events/{id}/confirm-index': {
      post: {
        tags: ['Event Registry'],
        summary: 'Confirm roster preview into event participants',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ConfirmRosterRequest' },
            },
          },
        },
        responses: { '200': jsonResponse('Activated event with participant batch') },
      },
    },
    '/api/events/{id}/check-participant': {
      post: {
        tags: ['Event Registry'],
        summary: 'Check whether current student is in confirmed roster',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Participant match result') },
      },
    },
    '/api/events/{id}/import-to-application': {
      post: {
        tags: ['Event Registry'],
        summary: 'Import active event participation as indexed evidence',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '201': jsonResponse('Created event-import evidence and card') },
      },
    },
    '/api/review/tasks': {
      get: {
        tags: ['Review'],
        summary: 'List officer review tasks',
        description:
          'Officer decision là xác nhận theo tiêu chí/task, chưa phải kết quả cuối cùng toàn hồ sơ.',
        security: bearerSecurity,
        parameters: [
          { in: 'query', name: 'status', schema: { type: 'string' } },
          { in: 'query', name: 'criterion', schema: { type: 'string' } },
          { in: 'query', name: 'assignedToMe', schema: { type: 'boolean' } },
          { in: 'query', name: 'applicationId', schema: { type: 'string' } },
          { in: 'query', name: 'q', schema: { type: 'string' } },
          { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20 } },
        ],
        responses: { '200': jsonResponse('Paginated review tasks') },
      },
    },
    '/api/review/tasks/{id}': {
      get: {
        tags: ['Review'],
        summary: 'Get review task detail with evidences, cards, precheck, cascade and KB matches',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Review task detail',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiResponse' },
                example: {
                  success: true,
                  data: {
                    task: { id: 'uuid', criterion: 'volunteer', status: 'reviewing' },
                    evidences: [
                      {
                        id: 'uuid',
                        evidenceName: 'Giấy xác nhận tình nguyện',
                        card: { confidence: 0.95, extractedFieldsJson: {} },
                      },
                    ],
                    knowledgeBaseMatches: [{ evidenceId: 'uuid', matches: [] }],
                  },
                  error: null,
                  meta: { requestId: 'req-id' },
                },
              },
            },
          },
        },
      },
    },
    '/api/review/tasks/{id}/decision': {
      post: {
        tags: ['Review'],
        summary: 'Submit an officer decision for one criterion task',
        description: 'Decision này chưa chốt finalStatus/finalLevel của toàn hồ sơ.',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ReviewTaskDecisionRequest' },
              examples: {
                accepted: { value: { decision: 'accepted', officerNote: 'Minh chứng phù hợp.' } },
                supplement: {
                  value: {
                    decision: 'supplement_required',
                    officerNote: 'Cần bổ sung giấy xác nhận rõ số ngày.',
                  },
                },
              },
            },
          },
        },
        responses: { '200': jsonResponse('Updated task and review progress') },
      },
    },
    '/api/review/tasks/{id}/request-supplement': {
      post: {
        tags: ['Review'],
        summary: 'Request supplement for a review task',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Supplement requested') },
      },
    },
    '/api/review/tasks/{id}/escalate-resolution': {
      post: {
        tags: ['Review'],
        summary: 'Escalate a review task to a basic resolution case',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Resolution case created') },
      },
    },
    '/api/manager/applications': {
      get: {
        tags: ['Manager'],
        summary: 'List submitted applications with review progress',
        security: bearerSecurity,
        responses: { '200': jsonResponse('Paginated manager applications') },
      },
    },
    '/api/manager/workloads': {
      get: {
        tags: ['Manager'],
        summary: 'List officer workloads',
        security: bearerSecurity,
        responses: { '200': jsonResponse('Officer workloads') },
      },
    },
    '/api/manager/review-tasks/{id}/assign': {
      post: {
        tags: ['Manager'],
        summary: 'Assign or reassign a review task',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['officerId'],
                properties: { officerId: { type: 'string' }, note: { type: 'string' } },
              },
              example: { officerId: 'uuid', note: 'Manager override assignment.' },
            },
          },
        },
        responses: { '200': jsonResponse('Task reassigned') },
      },
    },
    '/api/manager/applications/{id}/aggregation': {
      get: {
        tags: ['Manager'],
        summary: 'Get manager aggregation for final review',
        description: 'AI/precheck/cascade chỉ là dữ liệu tham khảo, không tự chốt kết quả.',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Aggregation summary with canFinalize') },
      },
    },
    '/api/manager/applications/{id}/finalize': {
      post: {
        tags: ['Manager'],
        summary: 'Finalize application result',
        description:
          'Chỉ Manager/Committee/Admin được chốt kết quả. AI/precheck/cascade chỉ là dữ liệu tham khảo.',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Final result') },
      },
    },
    '/api/manager/applications/{id}/reopen-final': {
      post: {
        tags: ['Manager'],
        summary: 'Reopen a finalized application',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Reopened application') },
      },
    },
    '/api/resolution/cases': {
      get: {
        tags: ['Resolution'],
        summary: 'List resolution cases',
        security: bearerSecurity,
        responses: { '200': jsonResponse('Paginated resolution cases') },
      },
    },
    '/api/resolution/cases/{id}': {
      get: {
        tags: ['Resolution'],
        summary: 'Get resolution case detail',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Resolution case detail') },
      },
    },
    '/api/resolution/cases/{id}/decision': {
      post: {
        tags: ['Resolution'],
        summary: 'Decide a resolution case and optionally save reusable KB item',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Resolution decision result') },
      },
    },
    '/api/resolution/cases/{id}/reopen': {
      post: {
        tags: ['Resolution'],
        summary: 'Reopen a closed resolution case',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Reopened resolution case') },
      },
    },
    '/api/knowledge-base/from-reviewed-evidence': {
      post: {
        tags: ['Knowledge Base'],
        summary: 'Create anonymized KB item from reviewed evidence',
        security: bearerSecurity,
        responses: { '201': jsonResponse('Knowledge base item created') },
      },
    },
    '/api/knowledge-base/{id}/use': {
      post: {
        tags: ['Knowledge Base'],
        summary: 'Increment KB usage count',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonResponse('Knowledge base item usage updated') },
      },
    },
    '/api/exports/review-results': {
      post: {
        tags: ['Exports'],
        summary: 'Export review results as JSON or CSV',
        description:
          'Không expose local file path. CSV được tải qua /api/exports/{fileId}/download.',
        security: bearerSecurity,
        responses: { '201': jsonResponse('Export result or file metadata') },
      },
    },
    '/api/exports/{fileId}/download': {
      get: {
        tags: ['Exports'],
        summary: 'Download export file through backend',
        description: 'Không expose local file path.',
        security: bearerSecurity,
        parameters: [{ in: 'path', name: 'fileId', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'CSV file stream' } },
      },
    },
    '/api/collective/current': {
      get: {
        tags: ['Collective'],
        summary: 'Get current collective profile or not_started state',
        security: bearerSecurity,
        parameters: [
          { in: 'query', name: 'schoolYear', schema: { type: 'string' } },
          { in: 'query', name: 'className', schema: { type: 'string' } },
        ],
        responses: { '200': jsonResponse('Current collective profile state') },
      },
    },
    '/api/collective/current/start': {
      post: {
        tags: ['Collective'],
        summary: 'Idempotently start a collective profile',
        security: bearerSecurity,
        requestBody: jsonRequest('#/components/schemas/StartCollectiveRequest'),
        responses: { '201': jsonResponse('Started or existing collective profile') },
      },
    },
    '/api/collective/{id}': {
      get: {
        tags: ['Collective'],
        summary: 'Get collective profile detail, summaries, review progress, and final result',
        security: bearerSecurity,
        parameters: [pathId()],
        responses: { '200': jsonResponse('Collective profile detail') },
      },
      patch: {
        tags: ['Collective'],
        summary: 'Update editable collective profile fields',
        security: bearerSecurity,
        parameters: [pathId()],
        responses: { '200': jsonResponse('Updated collective profile') },
      },
    },
    '/api/collective/{id}/members': {
      get: {
        tags: ['Collective'],
        summary: 'List roster members with member summary',
        security: bearerSecurity,
        parameters: [pathId()],
        responses: { '200': jsonResponse('Paginated collective members') },
      },
      post: {
        tags: ['Collective'],
        summary: 'Upsert a roster member by student code',
        security: bearerSecurity,
        parameters: [pathId()],
        requestBody: jsonRequest('#/components/schemas/CollectiveMemberRequest'),
        responses: { '201': jsonResponse('Upserted collective member') },
      },
    },
    '/api/collective/{id}/members/import': {
      post: {
        tags: ['Collective'],
        summary: 'Import roster from CSV or XLSX',
        security: bearerSecurity,
        parameters: [pathId()],
        requestBody: fileRequest(),
        responses: { '200': jsonResponse('Roster import summary') },
      },
    },
    '/api/collective/{id}/members/{memberId}': {
      patch: {
        tags: ['Collective'],
        summary: 'Update roster member statuses',
        security: bearerSecurity,
        parameters: [pathId(), pathParameter('memberId')],
        responses: { '200': jsonResponse('Updated collective member') },
      },
      delete: {
        tags: ['Collective'],
        summary: 'Delete a roster member',
        security: bearerSecurity,
        parameters: [pathId(), pathParameter('memberId')],
        responses: { '200': jsonResponse('Collective member deleted') },
      },
    },
    '/api/collective/{id}/evidences': {
      get: {
        tags: ['Collective'],
        summary: 'List collective evidences and OCR cards',
        security: bearerSecurity,
        parameters: [pathId()],
        responses: { '200': jsonResponse('Paginated collective evidences') },
      },
      post: {
        tags: ['Collective'],
        summary: 'Create a collective evidence record',
        security: bearerSecurity,
        parameters: [pathId()],
        requestBody: jsonRequest('#/components/schemas/CollectiveEvidenceRequest'),
        responses: { '201': jsonResponse('Collective evidence created') },
      },
    },
    '/api/collective/evidences/{evidenceId}/files': {
      post: {
        tags: ['Collective'],
        summary: 'Upload collective evidence file and queue OCR',
        security: bearerSecurity,
        parameters: [pathParameter('evidenceId')],
        requestBody: fileRequest(),
        responses: { '201': jsonResponse('File and indexing job created') },
      },
    },
    '/api/collective/evidences/{evidenceId}/start-indexing': {
      post: {
        tags: ['Collective'],
        summary: 'Start collective evidence OCR and Evidence Card generation',
        security: bearerSecurity,
        parameters: [pathParameter('evidenceId')],
        responses: { '200': jsonResponse('Indexing job state') },
      },
    },
    '/api/collective/{id}/import-event': {
      post: {
        tags: ['Collective'],
        summary: 'Import an active registry event as collective evidence',
        security: bearerSecurity,
        parameters: [pathId()],
        responses: { '201': jsonResponse('Imported event evidence') },
      },
    },
    '/api/collective/{id}/precheck': {
      post: {
        tags: ['Collective'],
        summary: 'Run collective rules precheck for the target level',
        description:
          'Kết quả chỉ phản ánh mức độ đủ dữ liệu sơ bộ; cán bộ/Hội đồng xác nhận kết quả cuối.',
        security: bearerSecurity,
        parameters: [pathId()],
        responses: { '200': jsonResponse('Collective precheck result') },
      },
    },
    '/api/collective/{id}/precheck/latest': {
      get: {
        tags: ['Collective'],
        summary: 'Get latest collective precheck snapshot',
        security: bearerSecurity,
        parameters: [pathId()],
        responses: { '200': jsonResponse('Latest collective precheck or null') },
      },
    },
    '/api/collective/{id}/submit': {
      post: {
        tags: ['Collective'],
        summary: 'Submit collective profile and create collective review task',
        security: bearerSecurity,
        parameters: [pathId()],
        responses: { '200': jsonResponse('Submitted collective profile') },
      },
    },
    '/api/manager/collective-profiles': {
      get: {
        tags: ['Manager', 'Collective'],
        summary: 'List collective profiles for manager review',
        security: bearerSecurity,
        responses: { '200': jsonResponse('Paginated collective profiles') },
      },
    },
    '/api/manager/collective-profiles/{id}/aggregation': {
      get: {
        tags: ['Manager', 'Collective'],
        summary: 'Aggregate roster, evidence, precheck, and collective review tasks',
        description: 'AI/precheck không tự chốt kết quả.',
        security: bearerSecurity,
        parameters: [pathId()],
        responses: { '200': jsonResponse('Collective aggregation and blockers') },
      },
    },
    '/api/manager/collective-profiles/{id}/finalize': {
      post: {
        tags: ['Manager', 'Collective'],
        summary: 'Finalize collective result as Manager, Committee, or Admin',
        security: bearerSecurity,
        parameters: [pathId()],
        requestBody: jsonRequest('#/components/schemas/FinalizeCollectiveRequest'),
        responses: { '200': jsonResponse('Final collective result') },
      },
    },
    '/api/audit/logs': placeholderPath('Audit', 'List audit logs placeholder'),
    '/api/chatbot/message': placeholderPath('AI', 'Send chatbot message placeholder'),
    '/api/smartux/events': placeholderPath('SmartUX', 'Create SmartUX event placeholder'),
    '/api/exports/applications': placeholderPath('Exports', 'Export applications placeholder'),
  },
};

function placeholderPath(tag: string, summary: string) {
  const method =
    summary.toLowerCase().startsWith('list') || summary.toLowerCase().startsWith('get')
      ? 'get'
      : 'post';

  return {
    [method]: {
      tags: [tag],
      summary,
      security: bearerSecurity,
      responses: {
        '501': jsonResponse('Module is not implemented yet'),
      },
    },
  };
}

function pathParameter(name: string) {
  return { in: 'path', name, required: true, schema: { type: 'string' } };
}

function pathId() {
  return pathParameter('id');
}

function jsonRequest(schemaRef: string) {
  return {
    required: true,
    content: { 'application/json': { schema: { $ref: schemaRef } } },
  };
}

function fileRequest() {
  return {
    required: true,
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          required: ['file'],
          properties: { file: { type: 'string', format: 'binary' } },
        },
      },
    },
  };
}
