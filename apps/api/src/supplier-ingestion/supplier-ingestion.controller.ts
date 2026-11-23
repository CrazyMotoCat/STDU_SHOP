import { SupplierReconciliationService } from './supplier-reconciliation.service.js';
import {
  IngestionSubmitIdentityInput,
  IngestionIdentityConfirmationInput,
  IngestionIdentityExecutionInput,
} from './supplier-reconciliation.dto.js';
import {
  IngestionEditsPreviewInput,
  IngestionApplyEditsInput,
} from './supplier-edits.dto.js';
import { SupplierCreateService } from './supplier-create.service.js';
import { SupplierApplyService } from './supplier-apply.service.js';
import {
  ingestionApplyResponses,
  ingestionCreateResponses,
  ingestionResponses,
  ingestionErrorSchema,
} from './supplier-ingestion.openapi.js';
import {
  Body,
  Catch,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
  type ArgumentsHost,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiBody,
  ApiParam,
  ApiQuery,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiCookieAuth,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { StaffOperation } from '../identity/authorization.js';
import {
  CsrfGuard,
  PermissionGuard,
  StaffSessionGuard,
} from '../identity/guards.js';
import { HttpBoundaryFilter } from '../identity/http-boundary.js';
import { StaffError } from '../identity/errors.js';
import type { StaffRequest } from '../identity/request.js';
import { DATABASE, PrismaDatabase } from '../database/database.module.js';
import {
  ingestionAudit,
  SupplierIngestionService,
} from './supplier-ingestion.service.js';
import {
  IngestionPreviewQuery,
  IngestionCreateInput,
  IngestionCreatePreviewInput,
  IngestionApplyInput,
  IngestionSourceInput,
  IngestionSourcePatch,
  IngestionRunInput,
  IngestionDecisionInput,
  IngestionPage,
  IngestionRowsPage,
} from './supplier-ingestion.dto.js';

const uuid = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () => new StaffError('VALIDATION_ERROR'),
});
const rowId = {
  transform(value: string) {
    if (!/^[a-f0-9]{64}$/.test(value)) throw new StaffError('VALIDATION_ERROR');
    return value;
  },
};

@Catch()
export class IngestionBoundary extends HttpBoundaryFilter {
  constructor(@Inject(DATABASE) private readonly db: PrismaDatabase) {
    super();
  }
  override async catch(error: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<StaffRequest>();
    if (error instanceof StaffError && error.getStatus() < 500) {
      const code = error.code;
      try {
        await this.db.$transaction((tx) =>
          ingestionAudit(
            tx,
            'ingestion.command.denied',
            null,
            code,
            {},
            request,
            'DENIED',
          ),
        );
      } catch {
        error = new StaffError('AUDIT_UNAVAILABLE');
      }
    }
    super.catch(error, host);
  }
}

@ApiTags('Supplier ingestion')
@ApiResponse({
  status: 400,
  description: 'Validation failed',
  schema: ingestionErrorSchema,
})
@ApiResponse({
  status: 401,
  description: 'Authentication required',
  schema: ingestionErrorSchema,
})
@ApiResponse({
  status: 403,
  description: 'Permission or CSRF denied',
  schema: ingestionErrorSchema,
})
@ApiResponse({
  status: 404,
  description: 'Resource not found',
  schema: ingestionErrorSchema,
})
@ApiResponse({
  status: 409,
  description: 'State, version or idempotency conflict',
  schema: ingestionErrorSchema,
})
@ApiResponse({
  status: 500,
  description: 'Internal error',
  schema: ingestionErrorSchema,
})
@ApiResponse({
  status: 503,
  description: 'Dependency or audit unavailable',
  schema: ingestionErrorSchema,
})
@ApiCookieAuth('staffCookie')
@Controller('v1/staff/ingestion')
@UseGuards(StaffSessionGuard, CsrfGuard, PermissionGuard)
@UseFilters(IngestionBoundary)
export class SupplierIngestionController {
  constructor(
    @Inject(SupplierIngestionService)
    private readonly service: SupplierIngestionService,
    @Inject(SupplierReconciliationService)
    private readonly reconciliation: SupplierReconciliationService,
    @Inject(SupplierApplyService)
    private readonly applyService: SupplierApplyService,
    @Inject(SupplierCreateService)
    private readonly createService: SupplierCreateService,
  ) {}
  private async respond(
    response: Response,
    result: Promise<{ status: number; body: unknown }>,
  ) {
    const receipt = await result;
    response.status(receipt.status);
    return receipt.body;
  }

  @Get('sources')
  @ApiOperation({ operationId: 'ingestion_listSources' })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiResponse({
    status: 200,
    description: 'Staff ingestion result',
    schema: ingestionResponses.listSources,
  })
  @StaffOperation({ permission: 'ingestion.read', csrf: 'NONE', audit: 'none' })
  listSources(@Req() request: StaffRequest, @Query() page: IngestionPage) {
    return this.service.listSources(request, page);
  }

  @Get('sources/:id')
  @ApiOperation({ operationId: 'ingestion_getSource' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiResponse({
    status: 200,
    description: 'Staff ingestion result',
    schema: ingestionResponses.getSource,
  })
  @StaffOperation({ permission: 'ingestion.read', csrf: 'NONE', audit: 'none' })
  getSource(@Req() request: StaffRequest, @Param('id', uuid) id: string) {
    return this.service.getSource(request, id);
  }

  @Post('sources')
  @ApiOperation({ operationId: 'ingestion_createSource' })
  @ApiBody({ type: IngestionSourceInput })
  @ApiResponse({
    status: 201,
    description: 'Staff ingestion result',
    schema: ingestionResponses.createSource,
  })
  @StaffOperation({
    permission: 'ingestion.sources.write',
    csrf: 'STAFF_BOUND',
    audit: 'ingestion.source.created',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 8, maxLength: 128 },
  })
  createSource(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
    @Body() input: IngestionSourceInput,
  ) {
    return this.respond(
      response,
      this.service.createSource(request, key, input),
    );
  }

  @Patch('sources/:id')
  @ApiOperation({ operationId: 'ingestion_updateSource' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ type: IngestionSourcePatch })
  @ApiResponse({
    status: 200,
    description: 'Staff ingestion result',
    schema: ingestionResponses.updateSource,
  })
  @StaffOperation({
    permission: 'ingestion.sources.write',
    csrf: 'STAFF_BOUND',
    audit: 'ingestion.source.changed',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 8, maxLength: 128 },
  })
  updateSource(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
    @Param('id', uuid) id: string,
    @Body() input: IngestionSourcePatch,
  ) {
    return this.respond(
      response,
      this.service.updateSource(request, key, id, input),
    );
  }

  @Post('runs')
  @ApiOperation({ operationId: 'ingestion_requestRun' })
  @ApiBody({ type: IngestionRunInput })
  @ApiResponse({
    status: 201,
    description: 'Staff ingestion result',
    schema: ingestionResponses.requestRun,
  })
  @StaffOperation({
    permission: 'ingestion.run',
    csrf: 'STAFF_BOUND',
    audit: 'ingestion.run.requested',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 8, maxLength: 128 },
  })
  requestRun(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
    @Body() input: IngestionRunInput,
  ) {
    return this.respond(response, this.service.requestRun(request, key, input));
  }

  @Get('runs')
  @ApiOperation({ operationId: 'ingestion_listRuns' })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiResponse({
    status: 200,
    description: 'Staff ingestion result',
    schema: ingestionResponses.listRuns,
  })
  @StaffOperation({ permission: 'ingestion.read', csrf: 'NONE', audit: 'none' })
  listRuns(@Req() request: StaffRequest, @Query() page: IngestionPage) {
    return this.service.listRuns(request, page);
  }

  @Get('runs/:id')
  @ApiOperation({ operationId: 'ingestion_getRun' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiResponse({
    status: 200,
    description: 'Staff ingestion result',
    schema: ingestionResponses.getRun,
  })
  @StaffOperation({ permission: 'ingestion.read', csrf: 'NONE', audit: 'none' })
  getRun(@Req() request: StaffRequest, @Param('id', uuid) id: string) {
    return this.service.getRun(request, id);
  }

  @Get('runs/:id/rows')
  @ApiOperation({ operationId: 'ingestion_rows' })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  })
  @ApiQuery({
    name: 'afterRow',
    required: false,
    schema: { type: 'integer', minimum: 0, maximum: 100 },
  })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiResponse({
    status: 200,
    description: 'Staff ingestion result',
    schema: ingestionResponses.rows,
  })
  @StaffOperation({ permission: 'ingestion.read', csrf: 'NONE', audit: 'none' })
  rows(
    @Req() request: StaffRequest,
    @Param('id', uuid) id: string,
    @Query() page: IngestionRowsPage,
  ) {
    return this.service.rows(request, id, page);
  }

  @Post('rows/:id/decision')
  @ApiOperation({ operationId: 'ingestion_decide' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiBody({ type: IngestionDecisionInput })
  @ApiResponse({
    status: 200,
    description: 'Staff ingestion result',
    schema: ingestionResponses.decide,
  })
  @StaffOperation({
    permission: 'ingestion.review',
    csrf: 'STAFF_BOUND',
    audit: 'ingestion.row.decided',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 8, maxLength: 128 },
  })
  decide(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
    @Param('id', rowId) id: string,
    @Body() input: IngestionDecisionInput,
  ) {
    return this.respond(response, this.service.decide(request, key, id, input));
  }

  @Get('rows/:id/decisions')
  @ApiOperation({ operationId: 'ingestion_decisions' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiResponse({
    status: 200,
    description: 'Staff ingestion result',
    schema: ingestionResponses.decisions,
  })
  @StaffOperation({ permission: 'ingestion.read', csrf: 'NONE', audit: 'none' })
  decisions(@Req() request: StaffRequest, @Param('id', rowId) id: string) {
    return this.service.decisions(request, id);
  }

  @Get('rows/:id/preview')
  @ApiOperation({ operationId: 'ingestion_previewApply' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiQuery({
    name: 'offerId',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiResponse({
    status: 200,
    description:
      'One staging row, explicit selected offer, comparison and safe provenance history',
    schema: ingestionApplyResponses.preview,
  })
  @StaffOperation({ permission: 'ingestion.read', csrf: 'NONE', audit: 'none' })
  preview(
    @Req() request: StaffRequest,
    @Param('id', rowId) id: string,
    @Query() query: IngestionPreviewQuery,
  ) {
    return this.applyService.preview(request, id, query.offerId);
  }

  @Get('rows/:id/applications')
  @ApiOperation({ operationId: 'ingestion_applications' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiResponse({
    status: 200,
    description: 'Immutable one-row application provenance',
    schema: ingestionApplyResponses.applications,
  })
  @StaffOperation({ permission: 'ingestion.read', csrf: 'NONE', audit: 'none' })
  applications(@Req() request: StaffRequest, @Param('id', rowId) id: string) {
    return this.applyService.applications(request, id);
  }

  @Post('rows/:id/apply')
  @ApiOperation({ operationId: 'ingestion_apply' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiBody({ type: IngestionApplyInput })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 8, maxLength: 128 },
  })
  @ApiResponse({
    status: 200,
    description:
      'Manually applied one accepted row, immutable revision and provenance',
    schema: ingestionApplyResponses.apply,
  })
  @StaffOperation({
    permission: 'ingestion.read',
    csrf: 'STAFF_BOUND',
    audit: 'supplier_offer.revised',
  })
  apply(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
    @Param('id', rowId) id: string,
    @Body() input: IngestionApplyInput,
  ) {
    return this.respond(
      response,
      this.applyService.apply(request, key, id, input),
    );
  }

  @Get('rows/:id/review-inspection')
  @ApiOperation({ operationId: 'ingestion_inspectCreate' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiResponse({
    status: 200,
    description: 'Bounded candidate inspection',
    schema: ingestionCreateResponses.inspection,
  })
  @StaffOperation({ permission: 'ingestion.read', csrf: 'NONE', audit: 'none' })
  reviewInspection(
    @Req() request: StaffRequest,
    @Param('id', rowId) id: string,
  ) {
    return this.createService.inspection(request, id);
  }

  @Post('rows/:id/create-preview')
  @ApiOperation({ operationId: 'ingestion_previewCreate' })
  @ApiBody({ type: IngestionCreatePreviewInput })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiResponse({
    status: 200,
    description: 'CREATE eligibility and preview token',
    schema: ingestionCreateResponses.preview,
  })
  @StaffOperation({
    permission: 'ingestion.createOffer',
    csrf: 'STAFF_BOUND',
    audit: 'none',
  })
  createPreview(
    @Req() request: StaffRequest,
    @Param('id', rowId) id: string,
    @Body() input: IngestionCreatePreviewInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.status(200);
    return this.createService.preview(request, id, input);
  }

  @Post('rows/:id/create')
  @ApiOperation({ operationId: 'ingestion_createOffer' })
  @ApiBody({ type: IngestionCreateInput })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 8, maxLength: 128 },
  })
  @ApiResponse({
    status: 201,
    description: 'Created offer provenance',
    schema: ingestionCreateResponses.create,
  })
  @StaffOperation({
    permission: 'ingestion.createOffer',
    csrf: 'STAFF_BOUND',
    audit: 'supplier_offer.created',
  })
  createOffer(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
    @Param('id', rowId) id: string,
    @Body() input: IngestionCreateInput,
  ) {
    return this.respond(
      response,
      this.createService.create(request, key, id, input),
    );
  }

  @Get('rows/:id/edit-history')
  @ApiOperation({ operationId: 'ingestion_editHistory' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiResponse({
    status: 200,
    description:
      'Immutable explicit edit details and bounded before/after values',
  })
  @StaffOperation({ permission: 'ingestion.read', csrf: 'NONE', audit: 'none' })
  editHistory(@Req() request: StaffRequest, @Param('id', rowId) id: string) {
    return this.applyService.editHistory(request, id);
  }

  @Get('rows/:id/edit-inspection')
  @ApiOperation({ operationId: 'ingestion_inspectEdits' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiQuery({
    name: 'offerId',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiResponse({
    status: 200,
    description:
      'Decision eligibility for a pending row with an exact existing offer',
  })
  @StaffOperation({
    permission: 'ingestion.applyEdits',
    csrf: 'NONE',
    audit: 'none',
  })
  editInspection(
    @Req() request: StaffRequest,
    @Param('id', rowId) id: string,
    @Query() query: IngestionPreviewQuery,
  ) {
    return this.applyService.editInspection(request, id, query.offerId);
  }

  @Post('rows/:id/edit-preview')
  @ApiOperation({ operationId: 'ingestion_previewEdits' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiResponse({
    status: 200,
    description:
      'Explicit edit preview with source freshness and signed intent',
  })
  @StaffOperation({
    permission: 'ingestion.applyEdits',
    csrf: 'STAFF_BOUND',
    audit: 'none',
  })
  editPreview(
    @Req() request: StaffRequest,
    @Param('id', rowId) id: string,
    @Body() input: IngestionEditsPreviewInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.status(200);
    return this.applyService.editPreview(request, id, input);
  }

  @Post('rows/:id/apply-edits')
  @ApiOperation({ operationId: 'ingestion_applyEdits' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 8, maxLength: 128 },
  })
  @ApiResponse({
    status: 200,
    description: 'Committed economic edit and immutable application receipt',
  })
  @StaffOperation({
    permission: 'ingestion.applyEdits',
    csrf: 'STAFF_BOUND',
    audit: 'supplier_offer.revised',
  })
  applyEdits(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
    @Param('id', rowId) id: string,
    @Body() input: IngestionApplyEditsInput,
  ) {
    return this.respond(
      response,
      this.applyService.applyEdits(request, key, id, input),
    );
  }

  @Get('rows/:id/application-provenance')
  @ApiOperation({ operationId: 'ingestion_applicationProvenance' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiResponse({
    status: 200,
    description: 'Immutable application provenance',
    schema: ingestionCreateResponses.provenance,
  })
  @StaffOperation({ permission: 'ingestion.read', csrf: 'NONE', audit: 'none' })
  applicationProvenance(
    @Req() request: StaffRequest,
    @Param('id', rowId) id: string,
  ) {
    return this.createService.provenance(request, id);
  }

  @Get('rows/:id/identity-inspection')
  @ApiOperation({ operationId: 'ingestion_inspectIdentity' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiResponse({
    status: 200,
    description: 'Pending row review eligibility without granting execution',
  })
  @StaffOperation({ permission: 'ingestion.read', csrf: 'NONE', audit: 'none' })
  ingestion_inspectIdentity(
    @Req() request: StaffRequest,
    @Param('id', rowId) id: string,
  ) {
    return this.reconciliation.inspect(request, id);
  }

  @Get('rows/:id/identity-reconciliations')
  @ApiOperation({ operationId: 'ingestion_identityHistory' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiResponse({
    status: 200,
    description: 'Bounded protected identity reconciliation history',
  })
  @StaffOperation({ permission: 'ingestion.read', csrf: 'NONE', audit: 'none' })
  ingestion_identityHistory(
    @Req() request: StaffRequest,
    @Param('id', rowId) id: string,
  ) {
    return this.reconciliation.history(request, id);
  }

  @Post('rows/:id/identity-reconciliations')
  @ApiOperation({ operationId: 'ingestion_submitIdentity' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 8, maxLength: 128 },
  })
  @ApiResponse({
    status: 201,
    description: 'Append-only target-bound identity submission',
  })
  @StaffOperation({
    permission: 'ingestion.reconcile.submit',
    csrf: 'STAFF_BOUND',
    audit: 'none',
  })
  ingestion_submitIdentity(
    @Req() request: StaffRequest,
    @Param('id', rowId) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
    @Body() body: IngestionSubmitIdentityInput,
  ) {
    return this.respond(
      response,
      this.reconciliation.submit(request, key, id, body),
    );
  }

  @Post('rows/:id/identity-reconciliations/:submissionId/confirm')
  @ApiOperation({ operationId: 'ingestion_approveIdentity' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiParam({
    name: 'submissionId',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 8, maxLength: 128 },
  })
  @ApiResponse({
    status: 200,
    description: 'Independent immutable identity confirmation',
  })
  @StaffOperation({
    permission: 'ingestion.reconcile.approve',
    csrf: 'STAFF_BOUND',
    audit: 'none',
  })
  ingestion_approveIdentity(
    @Req() request: StaffRequest,
    @Param('id', rowId) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
    @Param('submissionId', uuid) submissionId: string,
    @Body() body: IngestionIdentityConfirmationInput,
  ) {
    return this.respond(
      response,
      this.reconciliation.approve(request, key, id, submissionId, body),
    );
  }

  @Post('rows/:id/identity-reconciliations/:submissionId/apply')
  @ApiOperation({ operationId: 'ingestion_applyIdentity' })
  @ApiParam({
    name: 'id',
    schema: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  })
  @ApiParam({
    name: 'submissionId',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 8, maxLength: 128 },
  })
  @ApiResponse({
    status: 200,
    description: 'Explicit reconciled supplier update',
  })
  @StaffOperation({
    permission: 'ingestion.reconcile.execute',
    csrf: 'STAFF_BOUND',
    audit: 'supplier_offer.revised',
  })
  ingestion_applyIdentity(
    @Req() request: StaffRequest,
    @Param('id', rowId) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) response: Response,
    @Param('submissionId', uuid) submissionId: string,
    @Body() body: IngestionIdentityExecutionInput,
  ) {
    return this.respond(
      response,
      this.reconciliation.executeUpdate(request, key, id, submissionId, body),
    );
  }
}
