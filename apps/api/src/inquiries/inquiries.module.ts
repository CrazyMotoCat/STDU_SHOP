import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { PrivateFileStorage } from '../storage/private-file-storage.js';
import {
  PublicInquiryAttachmentsController,
  PublicInquiriesController,
  StaffInquiriesController,
} from './inquiries.controller.js';
import { InquiriesService } from './inquiries.service.js';
import { InquiryScanStreamServer } from './scan-stream.server.js';

@Module({
  imports: [IdentityModule],
  controllers: [
    PublicInquiriesController,
    PublicInquiryAttachmentsController,
    StaffInquiriesController,
  ],
  providers: [InquiriesService, PrivateFileStorage, InquiryScanStreamServer],
  exports: [InquiriesService],
})
export class InquiriesModule {}
