'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Package } from 'lucide-react';
import { OrderForm } from './order-form';
import { buttonVariants } from './ui/button';
import './orders-detail.css';

export function OrderCreate() {
  const router = useRouter();
  return (
    <div className="orders-detail-theme tw:grid tw:min-w-0 tw:gap-6 tw:text-[#18372e]">
      <Link
        className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'tw:-ml-3 tw:w-fit' })}
        href="/backoffice/orders"
      >
        <ArrowLeft aria-hidden="true" />
        All orders
      </Link>
      <header>
        <p className="tw:mt-0 tw:mb-3 tw:text-[10px] tw:font-bold tw:tracking-[1.7px] tw:text-[#226347] tw:uppercase">
          Backoffice · Inbox
        </p>
        <h1 className="tw:m-0 tw:text-[36px] tw:leading-tight tw:font-medium tw:tracking-[-1.2px] tw:max-[600px]:text-[29px]">
          Create order
        </h1>
        <p className="tw:mt-3 tw:mb-0 tw:text-sm tw:leading-relaxed tw:text-[#65716a]">
          Save the customer, work, items and manually agreed total.
        </p>
      </header>
      <section className="tw:min-w-0 tw:rounded-2xl tw:border tw:border-solid tw:border-[#e0e5da] tw:bg-[#fffefa] tw:p-6 tw:max-[600px]:p-4">
        <div className="tw:mb-5 tw:flex tw:items-center tw:gap-2">
          <Package className="tw:size-4 tw:shrink-0 tw:text-[#55734e]" aria-hidden="true" />
          <h2 className="tw:m-0 tw:text-base tw:font-semibold">New order details</h2>
        </div>
        <OrderForm onSaved={(order) => router.push(`/backoffice/orders/${order.id}`)} />
      </section>
    </div>
  );
}
