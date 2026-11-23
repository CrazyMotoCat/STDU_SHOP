export function reviewUiAcceptance(
  options: {
    api: string;
    cookies: Array<[string, string]>;
    runId: string;
    rowId: string;
  } & (
    | { offerId: string; brandId?: never; clear?: boolean }
    | { brandId: string; offerId?: never; clear?: never }
  ),
): Promise<void>;
