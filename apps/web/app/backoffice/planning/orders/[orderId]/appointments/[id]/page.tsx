import { AppointmentDetailScreen } from '../../../../../../../components/appointment-detail';

export default async function AppointmentPage({
  params,
}: Readonly<{ params: Promise<{ orderId: string; id: string }> }>) {
  const { orderId, id } = await params;
  return <AppointmentDetailScreen key={`${orderId}:${id}`} orderId={orderId} appointmentId={id} />;
}
