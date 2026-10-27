import InquiryWorkspace from '../workspace';

export default async function InquiryDetailPage({
  params,
}: {
  params: Promise<{ inquiryId: string }>;
}) {
  const { inquiryId } = await params;
  return <InquiryWorkspace inquiryId={inquiryId} />;
}
