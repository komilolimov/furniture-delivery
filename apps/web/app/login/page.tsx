import { redirect } from 'next/navigation';
import { LoginForm } from '../../components/login-form';
import { homeForRole } from '../../lib/session';
import { loadSession } from '../../lib/server-session';

export default async function LoginPage() {
  const session = await loadSession();
  if (session.kind === 'authenticated') redirect(homeForRole(session.user.role));
  return (
    <main className="tw:mx-auto tw:my-[60px] tw:grid tw:w-[calc(100%_-_40px)] tw:max-w-[460px] tw:gap-6 tw:max-[600px]:mt-[30px]">
      <a
        className="tw:inline-flex tw:min-w-0 tw:items-center tw:gap-3 tw:text-[16px] tw:font-bold tw:tracking-[-0.3px] tw:text-[#18372e] tw:no-underline tw:focus-visible:outline-3 tw:focus-visible:outline-offset-4 tw:focus-visible:outline-[#91b88e]"
        href="/"
      >
        <span
          className="tw:grid tw:size-10 tw:shrink-0 tw:place-items-center tw:rounded-[10px] tw:bg-[#18372e] tw:pr-[2px] tw:text-[22px] tw:tracking-[-2px] tw:text-white"
          aria-hidden="true"
        >
          fd.
        </span>
        Furniture Delivery
      </a>
      <section className="tw:min-w-0 tw:rounded-2xl tw:border tw:border-solid tw:border-[#e1e5dc] tw:bg-white tw:p-8 tw:max-[600px]:px-[22px] tw:max-[600px]:py-[26px]">
        <p className="tw:mt-0 tw:mb-[14px] tw:text-[10px] tw:leading-normal tw:font-bold tw:tracking-[1.7px] tw:text-[#65716a] tw:uppercase">
          Your workspace
        </p>
        <h1 className="tw:m-0 tw:text-[34px] tw:leading-[1.12] tw:font-medium tw:tracking-[-1.2px] tw:text-[#18372e]">
          Welcome back.
        </h1>
        <p className="tw:my-[14px] tw:text-[14px] tw:leading-[1.6] tw:font-normal tw:text-[#65716a]">
          Sign in with your personal account.
        </p>
        <LoginForm />
      </section>
      <a
        className="tw:w-fit tw:text-[12px] tw:leading-[1.6] tw:text-[#65716a] tw:underline tw:underline-offset-[3px] tw:hover:text-[#18372e] tw:focus-visible:outline-3 tw:focus-visible:outline-offset-4 tw:focus-visible:outline-[#91b88e]"
        href="/"
      >
        View service status
      </a>
    </main>
  );
}
