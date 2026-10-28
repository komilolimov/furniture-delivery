import { OrderDetailScreen } from '../../../../components/order-detail';

export default async function OrderDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <OrderDetailScreen key={id} orderId={id} />;
}
