import { CHATTERBOX_URL } from "@/lib/chatterbox";

export const maxDuration = 60;

export async function POST(request: Request) {
  const incoming = await request.formData();
  const file = incoming.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing file" }, { status: 400 });
  }

  const upstream = new FormData();
  upstream.append("files", file, file.name);

  let res: Response;
  try {
    res = await fetch(`${CHATTERBOX_URL}/upload_reference`, {
      method: "POST",
      body: upstream,
    });
  } catch {
    return Response.json(
      {
        error:
          "Voice engine is not reachable. Point CHATTERBOX_URL at a running engine — see the README.",
      },
      { status: 503 },
    );
  }

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
