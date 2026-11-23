export function reviewUiAcceptance(
  options: {
    api: string;
    cookies: Array<[string, string]>;
    runId: string;
    rowId: string;
    identity?: string;
    identityJourney?: {
      evidenceId: string;
      approverCookies: Array<[string, string]>;
      executorCookies: Array<[string, string]>;
    };
  } & (
    | { offerId: string; brandId?: never; clear?: boolean }
    | { brandId: string; offerId?: never; clear?: never }
  ),
): Promise<void>;
