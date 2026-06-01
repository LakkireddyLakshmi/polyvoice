import { CHATTERBOX_URL } from "@/lib/chatterbox";

export async function POST() {
  let res: Response;
  try {
    res = await fetch(`${CHATTERBOX_URL}/load_multilingual_model`, {
      method: "POST",
    });
  } catch {
    return Response.json(
      { error: "Voice engine is not reachable." },
      { status: 503 },
    );
  }
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
