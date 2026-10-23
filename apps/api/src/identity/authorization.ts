import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension, ApiHeader } from '@nestjs/swagger';

export const OPTIONAL_SESSION = 'stdu:optional-session';
export const REQUIRED_PERMISSION = 'stdu:required-permission';
export const STAFF_POLICY = 'stdu:staff-policy';

export interface StaffPolicy {
  permission: string | null;
  csrf: 'NONE' | 'LOGIN_OR_STAFF_BOUND' | 'STAFF_BOUND';
  audit: string;
}

export const OptionalSession = () => SetMetadata(OPTIONAL_SESSION, true);
export function StaffOperation(policy: StaffPolicy): MethodDecorator {
  return applyDecorators(
    SetMetadata(STAFF_POLICY, policy),
    ...(policy.permission
      ? [
          SetMetadata(REQUIRED_PERMISSION, policy.permission),
          ApiExtension('x-permission', policy.permission),
        ]
      : []),
    ApiExtension('x-csrf', policy.csrf),
    ApiExtension('x-audit', policy.audit),
    ...(policy.csrf === 'NONE'
      ? []
      : [
          ApiHeader({
            name: 'Origin',
            required: true,
            schema: { type: 'string', format: 'uri' },
          }),
          ApiHeader({
            name: 'X-CSRF-Token',
            required: true,
            schema: {
              type: 'string',
              minLength: 43,
              maxLength: 43,
              pattern: '^[A-Za-z0-9_-]{43}$',
              description:
                'Session/challenge-bound HMAC, not staff credential; no logs/storage.',
            },
          }),
        ]),
  );
}
