import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { StaffOperation } from '../identity/authorization.js';
import { StaffError } from '../identity/errors.js';
import {
  CsrfGuard,
  PermissionGuard,
  StaffSessionGuard,
} from '../identity/guards.js';
import type { StaffRequest } from '../identity/request.js';
import { CatalogErrorDto } from '../catalog/catalog.dto.js';
import { CatalogImportService } from './catalog-import.service.js';

interface UploadedSource {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@ApiTags('catalog-import-staff')
@ApiExtraModels(CatalogErrorDto)
@Controller('v1/staff/catalog/imports')
@UseGuards(StaffSessionGuard, CsrfGuard, PermissionGuard)
export class CatalogImportController {
  constructor(
    @Inject(CatalogImportService)
    private readonly imports: CatalogImportService,
  ) {}

  @Post()
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1,
        fields: 2,
        fieldSize: 64,
      },
    }),
  )
  @StaffOperation({
    permission: 'catalog.products.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.import.created',
  })
  @ApiOperation({ operationId: 'createCatalogImport' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      additionalProperties: false,
      properties: {
        file: { type: 'string', format: 'binary' },
        csvEncoding: { type: 'string', enum: ['UTF-8', 'WINDOWS-1251'] },
        csvDelimiter: { type: 'string', enum: [',', ';', '\t'] },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Private UNCHECKED source parsed and stored.',
  })
  upload(
    @Req() request: StaffRequest,
    @UploadedFile() file: UploadedSource | undefined,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Body('csvEncoding') csvEncoding: unknown,
    @Body('csvDelimiter') csvDelimiter: unknown,
  ) {
    const fields = Object.keys((request.body ?? {}) as Record<string, unknown>);
    if (
      fields.some(
        (fieldName) => !['csvEncoding', 'csvDelimiter'].includes(fieldName),
      )
    )
      throw new StaffError('VALIDATION_ERROR', [
        { field: 'body', code: 'UNKNOWN_FIELD' },
      ]);
    return this.imports.upload(
      request,
      file,
      idempotencyKey,
      csvEncoding,
      csvDelimiter,
    );
  }

  @Get()
  @StaffOperation({
    permission: 'catalog.products.read',
    csrf: 'NONE',
    audit: 'conditional catalog.import.cross_owner.accessed',
  })
  @ApiOperation({ operationId: 'listCatalogImports' })
  list(
    @Req() request: StaffRequest,
    @Query('pageSize') pageSize: unknown,
    @Query('cursor') cursor: unknown,
    @Query('ownerStaffUserId') ownerStaffUserId: unknown,
  ) {
    return this.imports.list(request, pageSize, cursor, ownerStaffUserId);
  }

  @Get(':runId')
  @StaffOperation({
    permission: 'catalog.products.read',
    csrf: 'NONE',
    audit: 'conditional catalog.import.cross_owner.accessed',
  })
  @ApiOperation({ operationId: 'getCatalogImport' })
  get(@Req() request: StaffRequest, @Param('runId') runId: string) {
    return this.imports.getRun(request, runId);
  }

  @Put(':runId/mapping')
  @StaffOperation({
    permission: 'catalog.products.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.import.mapping.changed',
  })
  @ApiOperation({ operationId: 'setCatalogImportMapping' })
  @ApiBody({ schema: { type: 'object' } })
  setMapping(
    @Req() request: StaffRequest,
    @Param('runId') runId: string,
    @Body() input: unknown,
  ) {
    return this.imports.setMapping(request, runId, input);
  }

  @Post(':runId/preview')
  @HttpCode(200)
  @StaffOperation({
    permission: 'catalog.products.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.import.preview.completed',
  })
  @ApiOperation({ operationId: 'previewOrResumeCatalogImport' })
  preview(@Req() request: StaffRequest, @Param('runId') runId: string) {
    return this.imports.preview(request, runId);
  }

  @Get(':runId/rows')
  @StaffOperation({
    permission: 'catalog.products.read',
    csrf: 'NONE',
    audit: 'conditional catalog.import.cross_owner.accessed',
  })
  @ApiOperation({ operationId: 'listCatalogImportRows' })
  rows(
    @Req() request: StaffRequest,
    @Param('runId') runId: string,
    @Query('pageSize') pageSize: unknown,
    @Query('cursor') cursor: unknown,
  ) {
    return this.imports.listRows(request, runId, pageSize, cursor);
  }

  @Post(':runId/rows/:rowId/decision')
  @HttpCode(200)
  @StaffOperation({
    permission: 'catalog.products.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.import.row.decided',
  })
  @ApiOperation({ operationId: 'decideCatalogImportRow' })
  @ApiBody({ schema: { type: 'object' } })
  decide(
    @Req() request: StaffRequest,
    @Param('runId') runId: string,
    @Param('rowId') rowId: string,
    @Body() input: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
  ) {
    return this.imports.decide(request, runId, rowId, input, idempotencyKey);
  }

  @Get(':runId/rows/:rowId/history')
  @StaffOperation({
    permission: 'catalog.products.read',
    csrf: 'NONE',
    audit: 'conditional catalog.import.cross_owner.accessed',
  })
  @ApiOperation({ operationId: 'getCatalogImportRowHistory' })
  history(
    @Req() request: StaffRequest,
    @Param('runId') runId: string,
    @Param('rowId') rowId: string,
    @Query('pageSize') pageSize: unknown,
    @Query('cursor') cursor: unknown,
  ) {
    return this.imports.history(request, runId, rowId, pageSize, cursor);
  }
}
