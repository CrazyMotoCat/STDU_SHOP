export function reviewUiAcceptance(options: {
  api: string;
  cookies: Array<[string, string]>;
  runId: string;
  rowId: string;
  offerId: string;
}): Promise<void>;
