import { CrewEditor } from '../../../../components/crew-editor';
export default async function CrewDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <CrewEditor key={id} crewId={id} />;
}
