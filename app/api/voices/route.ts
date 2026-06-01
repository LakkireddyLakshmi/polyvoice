import { CHATTERBOX_URL } from "@/lib/chatterbox";

export async function GET() {
  const res = await fetch(`${CHATTERBOX_URL}/get_reference_files`, {
    cache: "no-store",
  });
  if (!res.ok) {
    return Response.json(
      { error: "Chatterbox server unreachable" },
      { status: 502 },
    );
  }
  const files = (await res.json()) as string[];
  return Response.json({ files });
}
