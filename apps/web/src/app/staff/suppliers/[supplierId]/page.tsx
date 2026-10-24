import SupplierWorkspace from '../workspace';

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const { supplierId } = await params;
  return <SupplierWorkspace view="detail" supplierId={supplierId} />;
}
