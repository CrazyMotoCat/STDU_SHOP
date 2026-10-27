import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  type ApiBodyOptions,
  ApiConsumes,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { StaffOperation } from '../identity/authorization.js';
import {
  CsrfGuard,
  PermissionGuard,
  StaffSessionGuard,
} from '../identity/guards.js';
import type { StaffRequest } from '../identity/request.js';
import {
  AssignmentDto,
  CreateCommentDto,
  CreateInquiryDto,
  CreateUploadIntentDto,
  InquiryListQueryDto,
  PageQueryDto,
  StageDeadlineDto,
  TransitionDto,
} from './inquiries.dto.js';
import { InquiriesService } from './inquiries.service.js';

const CREATE_INQUIRY_REQUEST_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'contact', 'equipmentLines'],
      properties: {
        kind: { type: 'string', enum: ['EQUIPMENT'] },
        contact: { $ref: '#/components/schemas/ContactSnapshotDto' },
        catalogProductContext: {
          type: 'string',
          nullable: true,
          maxLength: 120,
        },
        uploadCapability: {
          type: 'string',
          nullable: true,
          pattern: '^[A-Za-z0-9_-]{43}$',
        },
        equipmentLines: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: { $ref: '#/components/schemas/EquipmentLineDto' },
        },
        privacyNotice: {
          type: 'object',
          nullable: true,
          additionalProperties: false,
          required: ['version', 'accepted'],
          properties: {
            version: { type: 'string', maxLength: 64 },
            accepted: { type: 'boolean' },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'contact', 'panels'],
      properties: {
        kind: { type: 'string', enum: ['PANELS'] },
        contact: { $ref: '#/components/schemas/ContactSnapshotDto' },
        catalogProductContext: {
          type: 'string',
          nullable: true,
          maxLength: 120,
        },
        uploadCapability: {
          type: 'string',
          nullable: true,
          pattern: '^[A-Za-z0-9_-]{43}$',
        },
        panels: { $ref: '#/components/schemas/PanelsDetailsDto' },
        privacyNotice: {
          type: 'object',
          nullable: true,
          additionalProperties: false,
          required: ['version', 'accepted'],
          properties: {
            version: { type: 'string', maxLength: 64 },
            accepted: { type: 'boolean' },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'contact', 'engineering'],
      properties: {
        kind: { type: 'string', enum: ['ENGINEERING'] },
        contact: { $ref: '#/components/schemas/ContactSnapshotDto' },
        catalogProductContext: {
          type: 'string',
          nullable: true,
          maxLength: 120,
        },
        uploadCapability: {
          type: 'string',
          nullable: true,
          pattern: '^[A-Za-z0-9_-]{43}$',
        },
        engineering: {
          $ref: '#/components/schemas/EngineeringDetailsDto',
        },
        privacyNotice: {
          type: 'object',
          nullable: true,
          additionalProperties: false,
          required: ['version', 'accepted'],
          properties: {
            version: { type: 'string', maxLength: 64 },
            accepted: { type: 'boolean' },
          },
        },
      },
    },
  ],
};

const UPLOAD_INTENT_REQUEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['filename', 'declaredMimeType', 'sizeBytes'],
  properties: {
    filename: { type: 'string', minLength: 1, maxLength: 255 },
    declaredMimeType: { type: 'string', minLength: 3, maxLength: 127 },
    sizeBytes: { type: 'integer', minimum: 1, maximum: 52428800 },
    expectedSha256: {
      type: 'string',
      nullable: true,
      pattern: '^[a-fA-F0-9]{64}$',
    },
  },
};
const ASSIGNMENT_REQUEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['staffUserId'],
  properties: {
    staffUserId: { type: 'string', format: 'uuid' },
  },
};
const STAGE_DEADLINE_REQUEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stageDueAt'],
  properties: {
    stageDueAt: { type: 'string', nullable: true, format: 'date-time' },
  },
};
const COMMENT_REQUEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['body'],
  properties: {
    body: { type: 'string', minLength: 1, maxLength: 4000, pattern: '\\S' },
  },
};

function mutationResponse(
  response: Response,
  result: {
    status: number;
    body: Record<string, unknown>;
  },
) {
  const envelope = result.body.data;
  if (envelope && typeof envelope === 'object' && 'version' in envelope) {
    const version = (envelope as { version?: unknown }).version;
    if (Number.isSafeInteger(version) && typeof version === 'number')
      response.setHeader('ETag', `"${version}"`);
  }
  return response.status(result.status).json(result.body);
}

@ApiTags('public-inquiries')
@Controller('v1/public/inquiries')
export class PublicInquiriesController {
  constructor(
    @Inject(InquiriesService) private readonly inquiries: InquiriesService,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ operationId: 'createPublicInquiry' })
  @ApiBody({ schema: CREATE_INQUIRY_REQUEST_SCHEMA } as ApiBodyOptions)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'Origin', required: true })
  create(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string,
    @Body() input: CreateInquiryDto,
    @Res() response: Response,
  ) {
    return this.inquiries
      .createPublic(request, key, input)
      .then((result) => response.status(result.status).json(result.body));
  }
}

@ApiTags('public-inquiry-attachments')
@Controller('v1/public/inquiry-attachments')
export class PublicInquiryAttachmentsController {
  constructor(
    @Inject(InquiriesService) private readonly inquiries: InquiriesService,
  ) {}

  @Post('upload-intents')
  @HttpCode(201)
  @ApiOperation({ operationId: 'createInquiryUploadIntent' })
  @ApiBody({ schema: UPLOAD_INTENT_REQUEST_SCHEMA } as ApiBodyOptions)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-Inquiry-Upload-Capability', required: true })
  createIntent(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string,
    @Headers('x-inquiry-upload-capability') capability: string,
    @Body() input: CreateUploadIntentDto,
    @Res() response: Response,
  ) {
    return this.inquiries
      .createUploadIntent(request, key, capability, input)
      .then((result) => response.status(result.status).json(result.body));
  }

  @Put('upload-intents/:intentId/content')
  @HttpCode(201)
  @ApiOperation({ operationId: 'uploadInquirySourceDocument' })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-Inquiry-Upload-Capability', required: true })
  upload(
    @Req() request: StaffRequest,
    @Param('intentId') intentId: string,
    @Headers('idempotency-key') key: string,
    @Headers('x-inquiry-upload-capability') capability: string,
    @Res() response: Response,
  ) {
    return this.inquiries
      .uploadContent(request, intentId, key, capability)
      .then((result) => response.status(result.status).json(result.body));
  }

  @Delete('upload-intents/:intentId')
  @HttpCode(204)
  @ApiOperation({ operationId: 'cancelInquiryUploadIntent' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-Inquiry-Upload-Capability', required: true })
  cancel(
    @Req() request: StaffRequest,
    @Param('intentId') intentId: string,
    @Headers('idempotency-key') key: string,
    @Headers('x-inquiry-upload-capability') capability: string,
    @Res() response: Response,
  ) {
    return this.inquiries
      .cancelUploadIntent(request, intentId, key, capability)
      .then((result) => response.status(result.status).end());
  }
}

@ApiTags('staff-inquiries')
@Controller('v1/staff/inquiries')
@UseGuards(StaffSessionGuard, CsrfGuard, PermissionGuard)
export class StaffInquiriesController {
  constructor(
    @Inject(InquiriesService) private readonly inquiries: InquiriesService,
  ) {}

  @Get()
  @StaffOperation({ permission: null, csrf: 'NONE', audit: 'inquiry.read' })
  @ApiOperation({ operationId: 'listStaffInquiries' })
  list(@Req() request: StaffRequest, @Query() query: InquiryListQueryDto) {
    return this.inquiries.list(request, query);
  }

  @Get(':inquiryId')
  @StaffOperation({ permission: null, csrf: 'NONE', audit: 'inquiry.read' })
  @ApiOperation({ operationId: 'getStaffInquiry' })
  @ApiOkResponse({
    headers: {
      ETag: {
        description:
          'Inquiry version, used with If-Match on aggregate mutations.',
        schema: { type: 'string' },
      },
    },
  })
  async detail(
    @Req() request: StaffRequest,
    @Param('inquiryId') inquiryId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.inquiries.detail(request, inquiryId);
    const version = result.data.version;
    if (Number.isSafeInteger(version) && typeof version === 'number')
      response.setHeader('ETag', `"${version}"`);
    return result;
  }

  @Get(':inquiryId/events')
  @StaffOperation({ permission: null, csrf: 'NONE', audit: 'inquiry.read' })
  @ApiOperation({ operationId: 'listInquiryEvents' })
  events(
    @Req() request: StaffRequest,
    @Param('inquiryId') inquiryId: string,
    @Query() query: PageQueryDto,
  ) {
    return this.inquiries.events(request, inquiryId, query);
  }

  @Patch(':inquiryId/manager')
  @StaffOperation({
    permission: 'inquiries.assign_manager',
    csrf: 'STAFF_BOUND',
    audit: 'inquiry.manager.assigned',
  })
  @ApiOperation({ operationId: 'assignInquiryManager' })
  @ApiBody({ schema: ASSIGNMENT_REQUEST_SCHEMA } as ApiBodyOptions)
  @ApiOkResponse({
    headers: { ETag: { schema: { type: 'string' } } },
  })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Current quoted Inquiry version.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  assignManager(
    @Req() request: StaffRequest,
    @Param('inquiryId') inquiryId: string,
    @Headers('if-match') ifMatch: string,
    @Headers('idempotency-key') key: string,
    @Body() input: AssignmentDto,
    @Res() response: Response,
  ) {
    return this.inquiries
      .assignManager(request, inquiryId, ifMatch, key, input)
      .then((result) => mutationResponse(response, result));
  }

  @Patch(':inquiryId/engineer')
  @StaffOperation({
    permission: 'inquiries.assign_engineer',
    csrf: 'STAFF_BOUND',
    audit: 'inquiry.engineer.assigned',
  })
  @ApiOperation({ operationId: 'assignInquiryEngineer' })
  @ApiBody({ schema: ASSIGNMENT_REQUEST_SCHEMA } as ApiBodyOptions)
  @ApiOkResponse({
    headers: { ETag: { schema: { type: 'string' } } },
  })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Current quoted Inquiry version.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  assignEngineer(
    @Req() request: StaffRequest,
    @Param('inquiryId') inquiryId: string,
    @Headers('if-match') ifMatch: string,
    @Headers('idempotency-key') key: string,
    @Body() input: AssignmentDto,
    @Res() response: Response,
  ) {
    return this.inquiries
      .assignEngineer(request, inquiryId, ifMatch, key, input)
      .then((result) => mutationResponse(response, result));
  }

  @Put(':inquiryId/stage-deadline')
  @StaffOperation({
    permission: 'inquiries.transition',
    csrf: 'STAFF_BOUND',
    audit: 'inquiry.stage_deadline.changed',
  })
  @ApiOperation({ operationId: 'setInquiryStageDeadline' })
  @ApiBody({ schema: STAGE_DEADLINE_REQUEST_SCHEMA } as ApiBodyOptions)
  @ApiOkResponse({
    headers: { ETag: { schema: { type: 'string' } } },
  })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Current quoted Inquiry version.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  stageDeadline(
    @Req() request: StaffRequest,
    @Param('inquiryId') inquiryId: string,
    @Headers('if-match') ifMatch: string,
    @Headers('idempotency-key') key: string,
    @Body() input: StageDeadlineDto,
    @Res() response: Response,
  ) {
    return this.inquiries
      .setStageDeadline(request, inquiryId, ifMatch, key, input)
      .then((result) => mutationResponse(response, result));
  }

  @Post(':inquiryId/transition')
  @StaffOperation({
    permission: 'inquiries.transition',
    csrf: 'STAFF_BOUND',
    audit: 'inquiry.transitioned',
  })
  @ApiOperation({ operationId: 'transitionStaffInquiry' })
  @ApiOkResponse({
    headers: { ETag: { schema: { type: 'string' } } },
  })
  @ApiBody({
    schema: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['toStatus', 'reasonCode'],
          properties: {
            toStatus: {
              type: 'string',
              enum: [
                'TRIAGE',
                'NEEDS_CLARIFICATION',
                'ENGINEERING_REVIEW',
                'READY_FOR_QUOTE',
              ],
            },
            reasonCode: {
              type: 'string',
              enum: [
                'TRIAGE_STARTED',
                'MORE_INFORMATION_REQUIRED',
                'INFORMATION_RECEIVED',
                'ENGINEERING_STARTED',
                'ENGINEERING_COMPLETE',
                'RETURN_TO_CLARIFICATION',
              ],
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['toStatus', 'reasonCode'],
          properties: {
            toStatus: { type: 'string', enum: ['CLOSED'] },
            reasonCode: {
              type: 'string',
              enum: [
                'DUPLICATE',
                'CUSTOMER_WITHDRAWN',
                'OUT_OF_SCOPE',
                'SPAM',
                'NOT_FEASIBLE',
              ],
            },
          },
        },
      ],
    },
  })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Current quoted Inquiry version.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  transition(
    @Req() request: StaffRequest,
    @Param('inquiryId') inquiryId: string,
    @Headers('if-match') ifMatch: string,
    @Headers('idempotency-key') key: string,
    @Body() input: TransitionDto,
    @Res() response: Response,
  ) {
    return this.inquiries
      .transition(request, inquiryId, ifMatch, key, input)
      .then((result) => mutationResponse(response, result));
  }

  @Get(':inquiryId/comments')
  @StaffOperation({
    permission: 'inquiries.comment',
    csrf: 'NONE',
    audit: 'inquiry.comment.read',
  })
  @ApiOperation({ operationId: 'listStaffInquiryComments' })
  comments(
    @Req() request: StaffRequest,
    @Param('inquiryId') inquiryId: string,
    @Query() query: PageQueryDto,
  ) {
    return this.inquiries.listComments(request, inquiryId, query);
  }

  @Post(':inquiryId/comments')
  @StaffOperation({
    permission: 'inquiries.comment',
    csrf: 'STAFF_BOUND',
    audit: 'inquiry.comment.created',
  })
  @ApiOperation({ operationId: 'createStaffInquiryComment' })
  @ApiBody({ schema: COMMENT_REQUEST_SCHEMA } as ApiBodyOptions)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createComment(
    @Req() request: StaffRequest,
    @Param('inquiryId') inquiryId: string,
    @Headers('idempotency-key') key: string,
    @Body() input: CreateCommentDto,
    @Res() response: Response,
  ) {
    return this.inquiries
      .createComment(request, inquiryId, key, input)
      .then((result) => response.status(result.status).json(result.body));
  }

  @Get(':inquiryId/documents')
  @StaffOperation({
    permission: 'inquiries.documents.read',
    csrf: 'NONE',
    audit: 'inquiry.document.read',
  })
  @ApiOperation({ operationId: 'listStaffInquiryDocuments' })
  documents(
    @Req() request: StaffRequest,
    @Param('inquiryId') inquiryId: string,
  ) {
    return this.inquiries.listDocuments(request, inquiryId);
  }

  @Get(':inquiryId/documents/:documentId/download')
  @StaffOperation({
    permission: 'inquiries.documents.download',
    csrf: 'NONE',
    audit: 'inquiry.document.downloaded',
  })
  @ApiOperation({ operationId: 'downloadStaffInquiryDocument' })
  async download(
    @Req() request: StaffRequest,
    @Param('inquiryId') inquiryId: string,
    @Param('documentId') documentId: string,
    @Res() response: Response,
  ) {
    const file = await this.inquiries.downloadDocument(
      request,
      inquiryId,
      documentId,
    );
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    response.setHeader('Cache-Control', 'no-store');
    file.stream.on('error', () => response.destroy());
    file.stream.pipe(response);
  }
}
