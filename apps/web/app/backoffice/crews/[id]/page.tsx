import { CrewEditor } from '../../../../components/crew-editor';
export default async function CrewDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  return <CrewEditor crewId={(await params).id} />;
}
