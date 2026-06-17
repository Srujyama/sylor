"use client";

export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

// Thin redirect: the real comparison UI lives at /simulations/compare.
// Passing ?ids=<id> preselects this simulation in the selector.
export default function CompareRedirectPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/simulations/compare?ids=${params.id}`);
  }, [router, params.id]);

  return (
    <div className="flex items-center justify-center py-32">
      <Loader2 className="w-5 h-5 animate-spin text-white/20" />
    </div>
  );
}
