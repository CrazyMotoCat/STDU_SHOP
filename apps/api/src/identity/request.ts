import type { Request, Response } from 'express';

export interface StaffPrincipal {
  id: string;
  email: string;
  displayName: string;
  passwordChangeRequired: boolean;
  authVersion: number;
  sessionId: string;
  permissionCodes: string[];
}

export interface StaffRequest extends Request {
  requestId: string;
  staff?: StaffPrincipal;
  res?: Response;
}
