import {
  applyDecorators,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  type PipeTransform,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiExtraModels,
  ApiExtension,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { StaffOperation } from '../identity/authorization.js';
import { StaffError } from '../identity/errors.js';
import {
  CsrfGuard,
  PermissionGuard,
  StaffSessionGuard,
} from '../identity/guards.js';
import type { StaffRequest } from '../identity/request.js';
import {
  CatalogErrorDto,
  CreateCatalogAttributeDto,
  CreateCatalogBrandDto,
  CreateCatalogCategoryDto,
  CreateCatalogProductDto,
  CatalogProductReviewDecisionDto,
  ReplaceCatalogProductDocumentsDto,
  ReplaceCatalogProductMediaDto,
  ReplaceCatalogProductRelationsDto,
  PatchCatalogAttributeDto,
  PatchCatalogBrandDto,
  PatchCatalogCategoryDto,
  PatchCatalogProductDraftDto,
  SubmitCatalogProductDto,
  VersionCommandDto,
  CATALOG_OPENAPI_MODELS,
} from './catalog.dto.js';
import { CatalogService } from './catalog.service.js';
import { CatalogProductService } from './catalog.product.service.js';

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class UuidV4Pipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (typeof value !== 'string' || !uuidV4.test(value))
      throw new StaffError('VALIDATION_ERROR', [
        { field: 'id', code: 'INVALID_UUID' },
      ]);
    return value.toLowerCase();
  }
}

const uuidPipe = new UuidV4Pipe();

function catalogErrors(
  options: { notFound?: boolean; conflict?: boolean; public?: boolean } = {},
) {
  return applyDecorators(
    ApiBadRequestResponse({
      schema: { $ref: '#/components/schemas/CatalogError' },
    }),
    ...(options.public
      ? []
      : [
          ApiUnauthorizedResponse({
            schema: { $ref: '#/components/schemas/CatalogError' },
          }),
          ApiForbiddenResponse({
            schema: { $ref: '#/components/schemas/CatalogError' },
          }),
          ApiNotFoundResponse({
            schema: { $ref: '#/components/schemas/CatalogError' },
          }),
          ApiResponse({
            status: 409,
            schema: { $ref: '#/components/schemas/CatalogError' },
          }),
          ApiResponse({
            status: 415,
            schema: { $ref: '#/components/schemas/CatalogError' },
          }),
        ]),
    ...(options.public
      ? [
          ApiNotFoundResponse({
            schema: { $ref: '#/components/schemas/CatalogError' },
          }),
        ]
      : []),
    ApiResponse({
      status: 500,
      schema: { $ref: '#/components/schemas/CatalogError' },
    }),
    ApiResponse({
      status: 503,
      schema: { $ref: '#/components/schemas/CatalogError' },
    }),
  );
}

function referenceListQuery() {
  return applyDecorators(
    ApiQuery({
      name: 'limit',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    }),
    ApiQuery({
      name: 'cursor',
      required: false,
      schema: {
        type: 'string',
        minLength: 1,
        maxLength: 256,
        pattern: '^[A-Za-z0-9_-]+$',
      },
    }),
  );
}

function catalogIdParam(name: string) {
  return ApiParam({
    name,
    required: true,
    schema: { type: 'string', format: 'uuid' },
  });
}

function mutationResponse(status = 200) {
  return ApiResponse({
    status,
    schema: { $ref: '#/components/schemas/MutationResponse' },
  });
}

@ApiTags('catalog-staff')
@ApiExtraModels(...CATALOG_OPENAPI_MODELS, CatalogErrorDto)
@Controller('v1/staff/catalog')
@UseGuards(StaffSessionGuard, CsrfGuard, PermissionGuard)
export class CatalogStaffController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(CatalogProductService)
    private readonly products: CatalogProductService,
  ) {}

  @Get('categories')
  @StaffOperation({
    permission: 'catalog.references.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiOperation({ operationId: 'listCatalogCategories' })
  @referenceListQuery()
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/CatalogCategoryListResponse' },
  })
  @catalogErrors()
  listCategories(
    @Req() request: StaffRequest,
    @Query('limit') limit: unknown,
    @Query('cursor') cursor: unknown,
  ) {
    return this.catalog.listCategories(request, limit, cursor);
  }

  @Post('categories')
  @HttpCode(201)
  @StaffOperation({
    permission: 'catalog.categories.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.reference.changed',
  })
  @ApiOperation({ operationId: 'createCatalogCategory' })
  @ApiBody({ type: CreateCatalogCategoryDto })
  @mutationResponse(201)
  @catalogErrors({ conflict: true })
  createCategory(
    @Req() request: StaffRequest,
    @Body() input: CreateCatalogCategoryDto,
  ) {
    return this.catalog.createCategory(request, input);
  }

  @Get('categories/:categoryId')
  @StaffOperation({
    permission: 'catalog.references.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiOperation({ operationId: 'getCatalogCategory' })
  @catalogIdParam('categoryId')
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/CatalogCategoryResponse' },
  })
  @catalogErrors({ notFound: true })
  getCategory(
    @Req() request: StaffRequest,
    @Param('categoryId', uuidPipe) categoryId: string,
  ) {
    return this.catalog.getCategory(request, categoryId);
  }

  @Patch('categories/:categoryId')
  @StaffOperation({
    permission: 'catalog.categories.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.reference.changed',
  })
  @ApiOperation({ operationId: 'patchCatalogCategory' })
  @catalogIdParam('categoryId')
  @ApiBody({ type: PatchCatalogCategoryDto })
  @mutationResponse()
  @catalogErrors({ notFound: true })
  patchCategory(
    @Req() request: StaffRequest,
    @Param('categoryId', uuidPipe) categoryId: string,
    @Body() input: PatchCatalogCategoryDto,
  ) {
    return this.catalog.patchCategory(request, categoryId, input);
  }

  @Post('categories/:categoryId/archive')
  @HttpCode(200)
  @StaffOperation({
    permission: 'catalog.categories.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.reference.changed',
  })
  @ApiOperation({ operationId: 'archiveCatalogCategory' })
  @catalogIdParam('categoryId')
  @ApiBody({ type: VersionCommandDto })
  @mutationResponse()
  @catalogErrors({ notFound: true, conflict: true })
  archiveCategory(
    @Req() request: StaffRequest,
    @Param('categoryId', uuidPipe) categoryId: string,
    @Body() input: VersionCommandDto,
  ) {
    return this.catalog.archiveCategory(request, categoryId, input);
  }

  @Get('brands')
  @StaffOperation({
    permission: 'catalog.references.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiOperation({ operationId: 'listCatalogBrands' })
  @referenceListQuery()
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/CatalogBrandListResponse' },
  })
  @catalogErrors()
  listBrands(
    @Req() request: StaffRequest,
    @Query('limit') limit: unknown,
    @Query('cursor') cursor: unknown,
  ) {
    return this.catalog.listBrands(request, limit, cursor);
  }

  @Post('brands')
  @HttpCode(201)
  @StaffOperation({
    permission: 'catalog.brands.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.reference.changed',
  })
  @ApiOperation({ operationId: 'createCatalogBrand' })
  @ApiBody({ type: CreateCatalogBrandDto })
  @mutationResponse(201)
  @catalogErrors({ conflict: true })
  createBrand(
    @Req() request: StaffRequest,
    @Body() input: CreateCatalogBrandDto,
  ) {
    return this.catalog.createBrand(request, input);
  }

  @Get('brands/:brandId')
  @StaffOperation({
    permission: 'catalog.references.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiOperation({ operationId: 'getCatalogBrand' })
  @catalogIdParam('brandId')
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/CatalogBrandResponse' },
  })
  @catalogErrors({ notFound: true })
  getBrand(
    @Req() request: StaffRequest,
    @Param('brandId', uuidPipe) brandId: string,
  ) {
    return this.catalog.getBrand(request, brandId);
  }

  @Patch('brands/:brandId')
  @StaffOperation({
    permission: 'catalog.brands.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.reference.changed',
  })
  @ApiOperation({ operationId: 'patchCatalogBrand' })
  @catalogIdParam('brandId')
  @ApiBody({ type: PatchCatalogBrandDto })
  @mutationResponse()
  @catalogErrors({ notFound: true, conflict: true })
  patchBrand(
    @Req() request: StaffRequest,
    @Param('brandId', uuidPipe) brandId: string,
    @Body() input: PatchCatalogBrandDto,
  ) {
    return this.catalog.patchBrand(request, brandId, input);
  }

  @Post('brands/:brandId/archive')
  @HttpCode(200)
  @StaffOperation({
    permission: 'catalog.brands.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.reference.changed',
  })
  @ApiOperation({ operationId: 'archiveCatalogBrand' })
  @catalogIdParam('brandId')
  @ApiBody({ type: VersionCommandDto })
  @mutationResponse()
  @catalogErrors({ notFound: true, conflict: true })
  archiveBrand(
    @Req() request: StaffRequest,
    @Param('brandId', uuidPipe) brandId: string,
    @Body() input: VersionCommandDto,
  ) {
    return this.catalog.archiveBrand(request, brandId, input);
  }

  @Get('attributes')
  @StaffOperation({
    permission: 'catalog.references.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiOperation({ operationId: 'listCatalogAttributes' })
  @referenceListQuery()
  @ApiQuery({
    name: 'categoryId',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/CatalogAttributeListResponse' },
  })
  @catalogErrors()
  listAttributes(
    @Req() request: StaffRequest,
    @Query('limit') limit: unknown,
    @Query('cursor') cursor: unknown,
    @Query('categoryId') categoryId: unknown,
  ) {
    return this.catalog.listAttributes(request, limit, cursor, categoryId);
  }

  @Post('attributes')
  @HttpCode(201)
  @StaffOperation({
    permission: 'catalog.attributes.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.reference.changed',
  })
  @ApiOperation({ operationId: 'createCatalogAttribute' })
  @ApiBody({ type: CreateCatalogAttributeDto })
  @mutationResponse(201)
  @catalogErrors({ notFound: true, conflict: true })
  createAttribute(
    @Req() request: StaffRequest,
    @Body() input: CreateCatalogAttributeDto,
  ) {
    return this.catalog.createAttribute(request, input);
  }

  @Get('attributes/:attributeId')
  @StaffOperation({
    permission: 'catalog.references.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiOperation({ operationId: 'getCatalogAttribute' })
  @catalogIdParam('attributeId')
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/CatalogAttributeResponse' },
  })
  @catalogErrors({ notFound: true })
  getAttribute(
    @Req() request: StaffRequest,
    @Param('attributeId', uuidPipe) attributeId: string,
  ) {
    return this.catalog.getAttribute(request, attributeId);
  }

  @Patch('attributes/:attributeId')
  @StaffOperation({
    permission: 'catalog.attributes.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.reference.changed',
  })
  @ApiOperation({ operationId: 'patchCatalogAttribute' })
  @catalogIdParam('attributeId')
  @ApiBody({ type: PatchCatalogAttributeDto })
  @mutationResponse()
  @catalogErrors({ notFound: true, conflict: true })
  patchAttribute(
    @Req() request: StaffRequest,
    @Param('attributeId', uuidPipe) attributeId: string,
    @Body() input: PatchCatalogAttributeDto,
  ) {
    return this.catalog.patchAttribute(request, attributeId, input);
  }

  @Post('attributes/:attributeId/archive')
  @HttpCode(200)
  @StaffOperation({
    permission: 'catalog.attributes.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.reference.changed',
  })
  @ApiOperation({ operationId: 'archiveCatalogAttribute' })
  @catalogIdParam('attributeId')
  @ApiBody({ type: VersionCommandDto })
  @mutationResponse()
  @catalogErrors({ notFound: true, conflict: true })
  archiveAttribute(
    @Req() request: StaffRequest,
    @Param('attributeId', uuidPipe) attributeId: string,
    @Body() input: VersionCommandDto,
  ) {
    return this.catalog.archiveAttribute(request, attributeId, input);
  }

  @Get('products')
  @StaffOperation({
    permission: 'catalog.products.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiOperation({ operationId: 'listStaffCatalogProducts' })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    schema: { type: 'string', minLength: 1, maxLength: 256 },
  })
  @ApiQuery({
    name: 'publicationState',
    required: false,
    schema: {
      type: 'string',
      enum: ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED'],
    },
  })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/StaffCatalogProductListResponse' },
  })
  @catalogErrors({ conflict: true })
  listProducts(
    @Req() request: StaffRequest,
    @Query('limit') limit: unknown,
    @Query('cursor') cursor: unknown,
    @Query('publicationState') publicationState: unknown,
    @Query('categoryId') categoryId: unknown,
  ) {
    return this.products.listProducts(
      request,
      limit,
      cursor,
      publicationState,
      categoryId,
    );
  }

  @Post('products')
  @HttpCode(201)
  @StaffOperation({
    permission: 'catalog.products.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.product.created',
  })
  @ApiOperation({ operationId: 'createCatalogProduct' })
  @ApiBody({ type: CreateCatalogProductDto })
  @mutationResponse(201)
  @catalogErrors({ notFound: true, conflict: true })
  createProduct(
    @Req() request: StaffRequest,
    @Body() input: CreateCatalogProductDto,
  ) {
    return this.products.createProduct(request, input);
  }

  @Get('products/:productId')
  @StaffOperation({
    permission: 'catalog.products.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiOperation({ operationId: 'getStaffCatalogProduct' })
  @catalogIdParam('productId')
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/StaffCatalogProductResponse' },
  })
  @catalogErrors({ notFound: true })
  getProduct(
    @Req() request: StaffRequest,
    @Param('productId', uuidPipe) productId: string,
  ) {
    return this.products.getProduct(request, productId);
  }

  @Patch('products/:productId')
  @StaffOperation({
    permission: 'catalog.products.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.product.revision.created',
  })
  @ApiOperation({ operationId: 'patchCatalogProductDraft' })
  @catalogIdParam('productId')
  @ApiBody({ type: PatchCatalogProductDraftDto })
  @mutationResponse()
  @catalogErrors({ notFound: true, conflict: true })
  patchProduct(
    @Req() request: StaffRequest,
    @Param('productId', uuidPipe) productId: string,
    @Body() input: PatchCatalogProductDraftDto,
  ) {
    return this.products.patchProduct(request, productId, input);
  }

  @Post('products/:productId/submit')
  @HttpCode(200)
  @StaffOperation({
    permission: 'catalog.products.submit',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.product.submitted',
  })
  @ApiOperation({ operationId: 'submitCatalogProduct' })
  @catalogIdParam('productId')
  @ApiBody({ type: SubmitCatalogProductDto })
  @mutationResponse()
  @catalogErrors({ notFound: true, conflict: true })
  submitProduct(
    @Req() request: StaffRequest,
    @Param('productId', uuidPipe) productId: string,
    @Body() input: SubmitCatalogProductDto,
  ) {
    return this.products.submitProduct(request, productId, input);
  }

  @Post('products/:productId/review')
  @HttpCode(200)
  @StaffOperation({
    permission: 'catalog.products.publish',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.product.reviewed',
  })
  @ApiOperation({ operationId: 'decideCatalogProductPublication' })
  @catalogIdParam('productId')
  @ApiBody({ type: CatalogProductReviewDecisionDto })
  @mutationResponse()
  @catalogErrors({ notFound: true, conflict: true })
  decideProduct(
    @Req() request: StaffRequest,
    @Param('productId', uuidPipe) productId: string,
    @Body() input: CatalogProductReviewDecisionDto,
  ) {
    return this.products.decideProduct(request, productId, input);
  }

  @Post('products/:productId/archive')
  @HttpCode(200)
  @StaffOperation({
    permission: 'catalog.products.archive',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.product.archived',
  })
  @ApiOperation({ operationId: 'archiveCatalogProduct' })
  @catalogIdParam('productId')
  @ApiBody({ type: VersionCommandDto })
  @mutationResponse()
  @catalogErrors({ notFound: true, conflict: true })
  archiveProduct(
    @Req() request: StaffRequest,
    @Param('productId', uuidPipe) productId: string,
    @Body() input: VersionCommandDto,
  ) {
    return this.products.archiveProduct(request, productId, input);
  }

  @Get('products/:productId/relations')
  @StaffOperation({
    permission: 'catalog.products.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiOperation({ operationId: 'listCatalogProductRelations' })
  @catalogIdParam('productId')
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/CatalogProductRelationsResponse' },
  })
  @catalogErrors({ notFound: true })
  listProductRelations(
    @Req() request: StaffRequest,
    @Param('productId', uuidPipe) productId: string,
  ) {
    return this.products.listProductRelations(request, productId);
  }

  @Put('products/:productId/relations')
  @StaffOperation({
    permission: 'catalog.products.relations.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.product.relations.changed',
  })
  @ApiOperation({ operationId: 'replaceCatalogProductRelations' })
  @catalogIdParam('productId')
  @ApiBody({ type: ReplaceCatalogProductRelationsDto })
  @mutationResponse()
  @catalogErrors({ notFound: true, conflict: true })
  replaceProductRelations(
    @Req() request: StaffRequest,
    @Param('productId', uuidPipe) productId: string,
    @Body() input: ReplaceCatalogProductRelationsDto,
  ) {
    return this.products.replaceProductRelations(request, productId, input);
  }

  @Get('products/:productId/media')
  @StaffOperation({
    permission: 'catalog.products.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiExtension('x-required-permissions', [
    'catalog.products.read',
    'files.metadata.read',
  ])
  @ApiOperation({ operationId: 'listCatalogProductMediaMetadata' })
  @catalogIdParam('productId')
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/CatalogProductMediaResponse' },
  })
  @catalogErrors({ notFound: true })
  listProductMedia(
    @Req() request: StaffRequest,
    @Param('productId', uuidPipe) productId: string,
  ) {
    return this.products.listProductMedia(request, productId);
  }

  @Put('products/:productId/media')
  @StaffOperation({
    permission: 'catalog.products.media.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.product.media.changed',
  })
  @ApiExtension('x-required-permissions', [
    'catalog.products.media.write',
    'files.metadata.read',
  ])
  @ApiOperation({ operationId: 'replaceCatalogProductMediaMetadata' })
  @catalogIdParam('productId')
  @ApiBody({ type: ReplaceCatalogProductMediaDto })
  @mutationResponse()
  @catalogErrors({ notFound: true, conflict: true })
  replaceProductMedia(
    @Req() request: StaffRequest,
    @Param('productId', uuidPipe) productId: string,
    @Body() input: ReplaceCatalogProductMediaDto,
  ) {
    return this.products.replaceProductMedia(request, productId, input);
  }

  @Get('products/:productId/documents')
  @StaffOperation({
    permission: 'catalog.products.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiExtension('x-required-permissions', [
    'catalog.products.read',
    'files.metadata.read',
  ])
  @ApiOperation({ operationId: 'listCatalogProductDocumentMetadata' })
  @catalogIdParam('productId')
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/CatalogProductDocumentsResponse' },
  })
  @catalogErrors({ notFound: true })
  listProductDocuments(
    @Req() request: StaffRequest,
    @Param('productId', uuidPipe) productId: string,
  ) {
    return this.products.listProductDocuments(request, productId);
  }

  @Put('products/:productId/documents')
  @StaffOperation({
    permission: 'catalog.products.documents.write',
    csrf: 'STAFF_BOUND',
    audit: 'catalog.product.documents.changed',
  })
  @ApiExtension('x-required-permissions', [
    'catalog.products.documents.write',
    'files.metadata.read',
  ])
  @ApiOperation({ operationId: 'replaceCatalogProductDocumentMetadata' })
  @catalogIdParam('productId')
  @ApiBody({ type: ReplaceCatalogProductDocumentsDto })
  @mutationResponse()
  @catalogErrors({ notFound: true, conflict: true })
  replaceProductDocuments(
    @Req() request: StaffRequest,
    @Param('productId', uuidPipe) productId: string,
    @Body() input: ReplaceCatalogProductDocumentsDto,
  ) {
    return this.products.replaceProductDocuments(request, productId, input);
  }
}

@ApiTags('catalog-public')
@ApiExtraModels(...CATALOG_OPENAPI_MODELS, CatalogErrorDto)
@Controller('v1/public/catalog')
export class CatalogPublicController {
  constructor(
    @Inject(CatalogProductService)
    private readonly products: CatalogProductService,
  ) {}

  @Get('categories')
  @ApiOperation({ operationId: 'listPublicCatalogCategoryChildren' })
  @ApiQuery({
    name: 'parentSlug',
    required: false,
    schema: {
      type: 'string',
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
      maxLength: 120,
    },
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    schema: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      pattern: '^[A-Za-z0-9_-]+$',
    },
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 24 },
  })
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/PublicCatalogCategoryListResponse' },
  })
  @catalogErrors({ notFound: true, public: true })
  listPublicCategoryChildren(
    @Req() request: StaffRequest,
    @Query('parentSlug') parentSlug: unknown,
    @Query('cursor') cursor: unknown,
    @Query('pageSize') pageSize: unknown,
  ) {
    return this.products.listPublicCategoryChildren(
      request,
      parentSlug,
      cursor,
      pageSize,
    );
  }

  @Get('products')
  @ApiOperation({ operationId: 'searchPublicCatalogProducts' })
  @ApiQuery({
    name: 'categorySlug',
    required: false,
    schema: { type: 'string', minLength: 1, maxLength: 120 },
  })
  @ApiQuery({
    name: 'includeDescendants',
    required: false,
    schema: { type: 'boolean', default: true },
  })
  @ApiQuery({
    name: 'brandSlug',
    required: false,
    schema: { type: 'string', minLength: 1, maxLength: 120 },
  })
  @ApiQuery({
    name: 'q',
    required: false,
    schema: { type: 'string', maxLength: 128 },
  })
  @ApiQuery({
    name: 'filter',
    required: false,
    isArray: true,
    style: 'form',
    explode: true,
    schema: { type: 'array', maxItems: 40, items: { type: 'string' } },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 },
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 24 },
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    schema: {
      type: 'string',
      enum: ['name_asc', 'name_desc', 'brand_asc', 'part_number_asc'],
      default: 'name_asc',
    },
  })
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/PublicCatalogProductListResponse' },
  })
  @catalogErrors({ notFound: true, public: true })
  searchPublicProducts(@Req() request: StaffRequest, @Query() query: unknown) {
    return this.products.searchPublicProducts(request, query);
  }

  @Get('products/:slug')
  @ApiOperation({ operationId: 'getPublicCatalogProductBySlug' })
  @ApiParam({
    name: 'slug',
    required: true,
    schema: {
      type: 'string',
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
      maxLength: 160,
    },
  })
  @ApiOkResponse({
    schema: { $ref: '#/components/schemas/PublicCatalogProductResponse' },
  })
  @catalogErrors({ notFound: true, public: true })
  getPublicProduct(@Req() request: StaffRequest, @Param('slug') slug: string) {
    return this.products.getPublicProduct(request, slug);
  }
}
