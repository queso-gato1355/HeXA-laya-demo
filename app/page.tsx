import Dashboard from "@/components/Dashboard";
import { getClip } from "@/data/routes";

// ?clip=<clipId> selects one of the demo clips (src/data/routes); unknown ids fall back to the first one
export default async function Page({ searchParams }: { searchParams: Promise<{ clip?: string }> }) {
  const { clip } = await searchParams;
  const c = getClip(clip);
  return <Dashboard key={c.clipId} clipId={c.clipId} />;
}
