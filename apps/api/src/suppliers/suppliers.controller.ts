import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiBody,
  ApiExtraModels,
  ApiExtension,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiHeader,
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
  ArchiveSupplierDto,
  CreateMatchProposalDto,
  CreateSupplierDto,
  CreateSupplierOfferDto,
  DecideMatchProposalDto,
  OfferListQueryDto,
  ProposalListQueryDto,
  ReviseSupplierOfferDto,
  SupplierListQueryDto,
  UnlinkMatchDto,
  UpdateSupplierDto,
  SupplierResponseDto,
  SupplierListResponseDto,
  SupplierRevisionListResponseDto,
  OfferListResponseDto,
  OfferRevisionListResponseDto,
  CandidateListResponseDto,
  CandidateListDataDto,
  MatchCandidateDto,
  ProposalListResponseDto,
  ProposalResponseDto,
  ProposalDto,
  AuditListResponseDto,
  SupplierMutationReceiptDto,
  OfferMutationReceiptDto,
  OfferUnlinkMutationDataDto,
  OfferUnlinkMutationReceiptDto,
  OfferResponseDto,
  SupplierDto,
  SupplierRevisionDto,
  OfferRevisionResponseDto,
  SupplierOfferDto,
  SupplierAuditEventDto,
  SupplierMutationDataDto,
  OfferMutationDataDto,
  SupplierErrorDto,
} from './suppliers.dto.js';
import { SuppliersService } from './suppliers.service.js';

const idPipe = new ParseUUIDPipe({ version: '4' });
const idParam = (name: string) =>
  ApiParam({
    name,
    required: true,
    schema: { type: 'string', format: 'uuid' },
  });
const mutationHeaders = () => [
  ApiHeader({
    name: 'Origin',
    required: true,
    schema: { type: 'string', format: 'uri' },
  }),
  ApiHeader({
    name: 'X-CSRF-Token',
    required: true,
    schema: { type: 'string', minLength: 43, maxLength: 43 },
  }),
  ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 8, maxLength: 128 },
  }),
];
const MutationHeaders = () => applyDecorators(...mutationHeaders());
const SupplierErrors = (...statuses: number[]) =>
  applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({ status, type: SupplierErrorDto }),
    ),
  );

@ApiTags('supplier-staff')
@ApiExtraModels(
  SupplierErrorDto,
  SupplierResponseDto,
  SupplierListResponseDto,
  SupplierRevisionListResponseDto,
  OfferListResponseDto,
  OfferRevisionListResponseDto,
  CandidateListResponseDto,
  CandidateListDataDto,
  MatchCandidateDto,
  ProposalListResponseDto,
  ProposalResponseDto,
  ProposalDto,
  AuditListResponseDto,
  SupplierMutationReceiptDto,
  OfferMutationReceiptDto,
  OfferUnlinkMutationDataDto,
  OfferUnlinkMutationReceiptDto,
  OfferResponseDto,
  SupplierDto,
  SupplierRevisionDto,
  OfferRevisionResponseDto,
  SupplierOfferDto,
  SupplierAuditEventDto,
  SupplierMutationDataDto,
  OfferMutationDataDto,
  CreateSupplierDto,
  UpdateSupplierDto,
  ArchiveSupplierDto,
  CreateSupplierOfferDto,
  ReviseSupplierOfferDto,
  CreateMatchProposalDto,
  DecideMatchProposalDto,
  UnlinkMatchDto,
)
@Controller()
@UseGuards(StaffSessionGuard, CsrfGuard, PermissionGuard)
export class SupplierStaffController {
  constructor(
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
  ) {}

  private async finish(
    response: Response,
    result: Promise<{ status: number; body: Record<string, unknown> }>,
  ) {
    const settled = await result;
    response.status(settled.status);
    return settled.body;
  }

  @Get('v1/staff/suppliers')
  @StaffOperation({ permission: 'suppliers.read', csrf: 'NONE', audit: 'none' })
  @ApiOperation({ operationId: 'listSuppliers' })
  @ApiOkResponse({ type: SupplierListResponseDto })
  @SupplierErrors(401, 403, 429)
  listSuppliers(
    @Req() request: StaffRequest,
    @Query() query: SupplierListQueryDto,
  ) {
    return this.suppliers.listSuppliers(request, query);
  }

  @Post('v1/staff/suppliers')
  @HttpCode(201)
  @StaffOperation({
    permission: 'suppliers.write',
    csrf: 'STAFF_BOUND',
    audit: 'supplier.created',
  })
  @ApiOperation({ operationId: 'createSupplier' })
  @ApiBody({ type: CreateSupplierDto })
  @ApiResponse({ status: 201, type: SupplierMutationReceiptDto })
  @SupplierErrors(400, 401, 403, 409, 422)
  @MutationHeaders()
  createSupplier(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateSupplierDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.finish(
      response,
      this.suppliers.createSupplier(request, key, input),
    );
  }

  @Get('v1/staff/suppliers/:supplierId')
  @StaffOperation({ permission: 'suppliers.read', csrf: 'NONE', audit: 'none' })
  @ApiOperation({ operationId: 'getSupplier' })
  @idParam('supplierId')
  @ApiOkResponse({ type: SupplierResponseDto })
  @SupplierErrors(401, 403, 404)
  getSupplier(
    @Req() request: StaffRequest,
    @Param('supplierId', idPipe) supplierId: string,
  ) {
    return this.suppliers.getSupplier(request, supplierId);
  }

  @Patch('v1/staff/suppliers/:supplierId')
  @StaffOperation({
    permission: 'suppliers.write',
    csrf: 'STAFF_BOUND',
    audit: 'supplier.changed',
  })
  @ApiOperation({ operationId: 'updateSupplier' })
  @MutationHeaders()
  @idParam('supplierId')
  @ApiBody({ type: UpdateSupplierDto })
  @ApiOkResponse({ type: SupplierMutationReceiptDto })
  @SupplierErrors(400, 401, 403, 404, 409, 422)
  updateSupplier(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Param('supplierId', idPipe) supplierId: string,
    @Body() input: UpdateSupplierDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.finish(
      response,
      this.suppliers.updateSupplier(request, key, supplierId, input),
    );
  }

  @Get('v1/staff/suppliers/:supplierId/revisions')
  @StaffOperation({ permission: 'suppliers.read', csrf: 'NONE', audit: 'none' })
  @ApiOperation({ operationId: 'listSupplierRevisions' })
  @idParam('supplierId')
  @ApiOkResponse({ type: SupplierRevisionListResponseDto })
  @SupplierErrors(401, 403, 404)
  listSupplierRevisions(
    @Req() request: StaffRequest,
    @Param('supplierId', idPipe) supplierId: string,
    @Query() query: SupplierListQueryDto,
  ) {
    return this.suppliers.listSupplierRevisions(request, supplierId, query);
  }

  @Post('v1/staff/suppliers/:supplierId/archive')
  @HttpCode(200)
  @StaffOperation({
    permission: 'suppliers.write',
    csrf: 'STAFF_BOUND',
    audit: 'supplier.archived',
  })
  @ApiOperation({ operationId: 'archiveSupplier' })
  @MutationHeaders()
  @idParam('supplierId')
  @ApiBody({ type: ArchiveSupplierDto })
  @ApiOkResponse({ type: SupplierMutationReceiptDto })
  @SupplierErrors(400, 401, 403, 404, 409)
  archiveSupplier(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Param('supplierId', idPipe) supplierId: string,
    @Body() input: ArchiveSupplierDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.finish(
      response,
      this.suppliers.archiveSupplier(request, key, supplierId, input),
    );
  }

  @Get('v1/staff/suppliers/:supplierId/offers')
  @StaffOperation({
    permission: 'suppliers.offers.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiExtension('x-additional-permissions', ['suppliers.read'])
  @ApiOperation({ operationId: 'listOffersForSupplier' })
  @idParam('supplierId')
  @ApiOkResponse({ type: OfferListResponseDto })
  @SupplierErrors(401, 403, 404)
  listOffersForSupplier(
    @Req() request: StaffRequest,
    @Param('supplierId', idPipe) supplierId: string,
    @Query() query: SupplierListQueryDto,
  ) {
    return this.suppliers.listOffersForSupplier(request, supplierId, query);
  }

  @Get('v1/staff/supplier-offers')
  @StaffOperation({
    permission: 'suppliers.offers.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiExtension('x-additional-permissions', ['suppliers.read'])
  @ApiOperation({ operationId: 'listSupplierOffers' })
  @ApiOkResponse({ type: OfferListResponseDto })
  @SupplierErrors(401, 403, 429)
  listSupplierOffers(
    @Req() request: StaffRequest,
    @Query() query: OfferListQueryDto,
  ) {
    return this.suppliers.listSupplierOffers(request, query);
  }

  @Post('v1/staff/supplier-offers')
  @HttpCode(201)
  @StaffOperation({
    permission: 'suppliers.offers.write',
    csrf: 'STAFF_BOUND',
    audit: 'supplier_offer.created',
  })
  @ApiOperation({ operationId: 'createSupplierOffer' })
  @MutationHeaders()
  @ApiBody({ type: CreateSupplierOfferDto })
  @ApiResponse({ status: 201, type: OfferMutationReceiptDto })
  @SupplierErrors(400, 401, 403, 404, 409, 422)
  createSupplierOffer(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateSupplierOfferDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.finish(
      response,
      this.suppliers.createSupplierOffer(request, key, input),
    );
  }

  @Get('v1/staff/supplier-offers/:offerId')
  @StaffOperation({
    permission: 'suppliers.offers.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiExtension('x-additional-permissions', ['suppliers.read'])
  @ApiOperation({ operationId: 'getSupplierOffer' })
  @idParam('offerId')
  @ApiOkResponse({ type: OfferResponseDto })
  @SupplierErrors(401, 403, 404)
  getSupplierOffer(
    @Req() request: StaffRequest,
    @Param('offerId', idPipe) offerId: string,
  ) {
    return this.suppliers.getSupplierOffer(request, offerId);
  }

  @Patch('v1/staff/supplier-offers/:offerId')
  @StaffOperation({
    permission: 'suppliers.offers.write',
    csrf: 'STAFF_BOUND',
    audit: 'supplier_offer.revised',
  })
  @ApiOperation({ operationId: 'reviseSupplierOffer' })
  @MutationHeaders()
  @idParam('offerId')
  @ApiBody({ type: ReviseSupplierOfferDto })
  @ApiOkResponse({ type: OfferMutationReceiptDto })
  @SupplierErrors(400, 401, 403, 404, 409, 422)
  reviseSupplierOffer(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Param('offerId', idPipe) offerId: string,
    @Body() input: ReviseSupplierOfferDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.finish(
      response,
      this.suppliers.reviseSupplierOffer(request, key, offerId, input),
    );
  }

  @Post('v1/staff/supplier-offers/:offerId/archive')
  @HttpCode(200)
  @StaffOperation({
    permission: 'suppliers.offers.write',
    csrf: 'STAFF_BOUND',
    audit: 'supplier_offer.archived',
  })
  @ApiOperation({ operationId: 'archiveSupplierOffer' })
  @MutationHeaders()
  @idParam('offerId')
  @ApiBody({ type: ArchiveSupplierDto })
  @ApiOkResponse({ type: OfferMutationReceiptDto })
  @SupplierErrors(400, 401, 403, 404, 409)
  archiveSupplierOffer(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Param('offerId', idPipe) offerId: string,
    @Body() input: ArchiveSupplierDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.finish(
      response,
      this.suppliers.archiveSupplierOffer(request, key, offerId, input),
    );
  }

  @Get('v1/staff/supplier-offers/:offerId/revisions')
  @StaffOperation({
    permission: 'suppliers.offers.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiExtension('x-additional-permissions', ['suppliers.read'])
  @ApiOperation({ operationId: 'listSupplierOfferRevisions' })
  @idParam('offerId')
  @ApiOkResponse({ type: OfferRevisionListResponseDto })
  @SupplierErrors(401, 403, 404)
  listSupplierOfferRevisions(
    @Req() request: StaffRequest,
    @Param('offerId', idPipe) offerId: string,
    @Query() query: SupplierListQueryDto,
  ) {
    return this.suppliers.listSupplierOfferRevisions(request, offerId, query);
  }

  @Get('v1/staff/supplier-offers/:offerId/match-candidates')
  @StaffOperation({
    permission: 'suppliers.offers.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiExtension('x-additional-permissions', [
    'suppliers.read',
    'catalog.products.read',
    'catalog.references.read',
  ])
  @ApiOperation({ operationId: 'listExactSupplierMatchCandidates' })
  @idParam('offerId')
  @ApiOkResponse({ type: CandidateListResponseDto })
  @SupplierErrors(401, 403, 404)
  listExactSupplierMatchCandidates(
    @Req() request: StaffRequest,
    @Param('offerId', idPipe) offerId: string,
  ) {
    return this.suppliers.listExactSupplierMatchCandidates(request, offerId);
  }

  @Get('v1/staff/supplier-match-proposals')
  @StaffOperation({
    permission: 'suppliers.offers.read',
    csrf: 'NONE',
    audit: 'none',
  })
  @ApiExtension('x-additional-permissions', [
    'suppliers.read',
    'catalog.products.read',
    'catalog.references.read',
  ])
  @ApiOperation({ operationId: 'listSupplierMatchProposals' })
  @ApiOkResponse({ type: ProposalListResponseDto })
  @SupplierErrors(401, 403)
  listSupplierMatchProposals(
    @Req() request: StaffRequest,
    @Query() query: ProposalListQueryDto,
  ) {
    return this.suppliers.listSupplierMatchProposals(request, query);
  }

  @Post('v1/staff/supplier-offers/:offerId/match-proposals')
  @HttpCode(201)
  @StaffOperation({
    permission: 'suppliers.matches.decide',
    csrf: 'STAFF_BOUND',
    audit: 'supplier_match.proposed',
  })
  @ApiExtension('x-additional-permissions', [
    'suppliers.offers.read',
    'suppliers.read',
    'catalog.products.read',
    'catalog.references.read',
  ])
  @ApiOperation({ operationId: 'createSupplierMatchProposal' })
  @MutationHeaders()
  @idParam('offerId')
  @ApiBody({ type: CreateMatchProposalDto })
  @ApiResponse({ status: 201, type: ProposalResponseDto })
  @SupplierErrors(400, 401, 403, 404, 409, 422)
  createSupplierMatchProposal(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Param('offerId', idPipe) offerId: string,
    @Body() input: CreateMatchProposalDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.finish(
      response,
      this.suppliers.createSupplierMatchProposal(request, key, offerId, input),
    );
  }

  @Post('v1/staff/supplier-match-proposals/:proposalId/decision')
  @HttpCode(200)
  @StaffOperation({
    permission: 'suppliers.matches.decide',
    csrf: 'STAFF_BOUND',
    audit: 'supplier_match.approved|supplier_match.rejected',
  })
  @ApiExtension('x-additional-permissions', [
    'suppliers.offers.read',
    'suppliers.read',
    'catalog.products.read',
    'catalog.references.read',
  ])
  @ApiOperation({ operationId: 'decideSupplierMatchProposal' })
  @MutationHeaders()
  @idParam('proposalId')
  @ApiBody({ type: DecideMatchProposalDto })
  @ApiOkResponse({ type: ProposalResponseDto })
  @SupplierErrors(400, 401, 403, 404, 409, 422)
  decideSupplierMatchProposal(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Param('proposalId', idPipe) proposalId: string,
    @Body() input: DecideMatchProposalDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.finish(
      response,
      this.suppliers.decideSupplierMatchProposal(
        request,
        key,
        proposalId,
        input,
      ),
    );
  }

  @Post('v1/staff/supplier-offers/:offerId/match/unlink')
  @HttpCode(200)
  @StaffOperation({
    permission: 'suppliers.matches.decide',
    csrf: 'STAFF_BOUND',
    audit: 'supplier_match.unlinked',
  })
  @ApiExtension('x-additional-permissions', [
    'suppliers.offers.read',
    'suppliers.read',
    'catalog.products.read',
    'catalog.references.read',
  ])
  @ApiOperation({ operationId: 'unlinkSupplierOfferMatch' })
  @MutationHeaders()
  @idParam('offerId')
  @ApiBody({ type: UnlinkMatchDto })
  @ApiOkResponse({ type: OfferUnlinkMutationReceiptDto })
  @SupplierErrors(400, 401, 403, 404, 409)
  unlinkSupplierOfferMatch(
    @Req() request: StaffRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Param('offerId', idPipe) offerId: string,
    @Body() input: UnlinkMatchDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.finish(
      response,
      this.suppliers.unlinkSupplierOfferMatch(request, key, offerId, input),
    );
  }

  @Get('v1/staff/suppliers/:supplierId/audit')
  @StaffOperation({
    permission: 'suppliers.read',
    csrf: 'NONE',
    audit: 'supplier.audit.read',
  })
  @ApiExtension('x-additional-permissions', ['audit.read'])
  @ApiOperation({ operationId: 'listSupplierAudit' })
  @idParam('supplierId')
  @ApiOkResponse({ type: AuditListResponseDto })
  @SupplierErrors(401, 403, 404)
  listSupplierAudit(
    @Req() request: StaffRequest,
    @Param('supplierId', idPipe) supplierId: string,
    @Query() query: SupplierListQueryDto,
  ) {
    return this.suppliers.listSupplierAudit(request, supplierId, query);
  }

  @Get('v1/staff/supplier-offers/:offerId/audit')
  @StaffOperation({
    permission: 'suppliers.offers.read',
    csrf: 'NONE',
    audit: 'supplier.audit.read',
  })
  @ApiExtension('x-additional-permissions', ['suppliers.read', 'audit.read'])
  @ApiOperation({ operationId: 'listSupplierOfferAudit' })
  @idParam('offerId')
  @ApiOkResponse({ type: AuditListResponseDto })
  @SupplierErrors(401, 403, 404)
  listSupplierOfferAudit(
    @Req() request: StaffRequest,
    @Param('offerId', idPipe) offerId: string,
    @Query() query: SupplierListQueryDto,
  ) {
    return this.suppliers.listSupplierOfferAudit(request, offerId, query);
  }
}
