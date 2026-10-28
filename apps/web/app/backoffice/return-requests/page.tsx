import { ReturnRequestQueue } from '../../../components/return-request-queue';
export default async function ReturnRequestsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ status?: string }> }>) {
  const { status } = await searchParams;
  const initialStatus =
    status === 'PLANNED' || status === 'RESOLVED' ? status : status === '' ? '' : 'OPEN';
  return <ReturnRequestQueue key={initialStatus} initialStatus={initialStatus} />;
}
