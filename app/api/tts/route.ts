import { CHATTERBOX_URL, type TTSRequest } from "@/lib/chatterbox";

export async function POST(request: Request) {
  const body = (await request.json()) as TTSRequest;

  if (!body.text || body.text.trim().length === 0) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }
  if (body.voice_mode === "clone" && !body.reference_audio_filename) {
    return Response.json(
      { error: "reference_audio_filename required for clone mode" },
      { status: 400 },
    );
  }

  let res: Response;
  try {
    res = await fetch(`${CHATTERBOX_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        output_format: "wav",
        split_text: true,
        chunk_size: 200,
        ...body,
      }),
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

  if (!res.ok || !res.body) {
    const text = await res.text();
    return Response.json(
      { error: text || "Chatterbox returned an error" },
      { status: res.status || 502 },
    );
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "audio/wav",
      "Cache-Control": "no-store",
    },
  });
}
