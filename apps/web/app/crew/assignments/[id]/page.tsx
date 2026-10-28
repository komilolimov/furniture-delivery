import { CrewAssignmentDetailView } from '../../../../components/crew-assignment-detail';
export default async function AssignmentPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <CrewAssignmentDetailView key={id} assignmentId={id} />;
}
