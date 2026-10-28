'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from './ui/button';

export function ServiceBackButton() {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push('/login');
      }}
    >
      <ArrowLeft aria-hidden="true" />
      Back
    </Button>
  );
}
