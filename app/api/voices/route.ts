import { CHATTERBOX_URL } from "@/lib/chatterbox";

export async function GET() {
  let res: Response;
  try {
    res = await fetch(`${CHATTERBOX_URL}/get_reference_files`, {
      cache: "no-store",
    });
  } catch {
    // Engine offline (e.g. on the public demo without a connected engine) —
    // degrade gracefully so the UI just shows no voices instead of crashing.
    return Response.json({ files: [], engineOffline: true });
  }
  if (!res.ok) {
    return Response.json(
      { error: "Chatterbox server unreachable" },
      { status: 502 },
    );
  }
  const files = (await res.json()) as string[];
  return Response.json({ files });
}
