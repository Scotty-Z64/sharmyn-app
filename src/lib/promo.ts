import { trpc } from '@/providers/trpc';

/** Is the Sharmyn Opening Special running? False until the server has said so, so a saving is never shown that won't be charged. */
export function useOpeningSpecial(): boolean {
  const q = trpc.shop.promo.useQuery(undefined, { staleTime: 60_000 });
  return q.data?.openingSpecial === true;
}
