export function reviewUiAcceptance(
  options: {
    api: string;
    cookies: Array<[string, string]>;
    runId: string;
    rowId: string;
  } & (
    { offerId: string; brandId?: never } | { brandId: string; offerId?: never }
  ),
): Promise<void>;
