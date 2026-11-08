import {
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
}
