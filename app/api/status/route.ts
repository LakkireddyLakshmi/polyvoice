import { CHATTERBOX_URL } from "@/lib/chatterbox";

export async function GET() {
  try {
    const res = await fetch(`${CHATTERBOX_URL}/api/ui/initial-data`, {
      cache: "no-store",
    });
    return Response.json({ ok: res.ok, status: res.status });
  } catch {
    return Response.json({ ok: false, status: 0 }, { status: 200 });
  }
}
