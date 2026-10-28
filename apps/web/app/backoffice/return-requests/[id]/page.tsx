import { ReturnRequestDetailScreen } from '../../../../components/return-request-panel';
export default async function ReturnRequestPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <ReturnRequestDetailScreen requestId={id} />;
}
