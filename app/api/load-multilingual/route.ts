import { CHATTERBOX_URL } from "@/lib/chatterbox";

export async function POST() {
  const res = await fetch(`${CHATTERBOX_URL}/load_multilingual_model`, {
    method: "POST",
  });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
