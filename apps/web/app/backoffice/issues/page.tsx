import { IssuesList } from '../../../components/issues-list';
export default async function IssuesPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ status?: string }> }>) {
  const { status } = await searchParams;
  const initialStatus = status === 'OPEN' || status === 'RESOLVED' ? status : '';
  return <IssuesList key={initialStatus} initialStatus={initialStatus} />;
}
