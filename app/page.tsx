"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LANGUAGES } from "@/lib/chatterbox";

type Consent = {
  speakerName: string;
  signedAt: string;
  commercial: boolean;
  revocable: true;
};

type Generation = {
  id: string;
  text: string;
  language: string;
  voiceFile: string;
  url: string;
  createdAt: string;
};

type ServerStatus = "checking" | "online" | "offline";

const CONSENT_KEY = "polyvoice.consent.v1";

type VoicePreset = {
  name: string;
  exaggeration: number;
  cfgWeight: number;
  temperature: number;
  speed: number;
};

const VOICE_PRESETS: VoicePreset[] = [
  { name: "Natural", exaggeration: 0.5, cfgWeight: 0.5, temperature: 0.8, speed: 1.0 },
  { name: "Expressive", exaggeration: 1.0, cfgWeight: 0.3, temperature: 0.9, speed: 1.0 },
  { name: "Stable", exaggeration: 0.35, cfgWeight: 0.7, temperature: 0.6, speed: 1.0 },
];

export default function Home() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [serverStatus, setServerStatus] = useState<ServerStatus>("checking");

  const [speakerName, setSpeakerName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [commercial, setCommercial] = useState(false);
  const [consent, setConsent] = useState<Consent | null>(null);

  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [text, setText] = useState(
    "Hello — this voice was cloned with explicit consent, and you can hear it speaking a language the original speaker never recorded.",
  );
  const [language, setLanguage] = useState("en");
  const [exaggeration, setExaggeration] = useState(0.5);
  const [cfgWeight, setCfgWeight] = useState(0.5);
  const [temperature, setTemperature] = useState(0.8);
  const [speed, setSpeed] = useState(1.0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [history, setHistory] = useState<Generation[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Consent;
      setConsent(parsed);
      setStep(2);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean };
        if (!cancelled) setServerStatus(data.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setServerStatus("offline");
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const ready = useMemo(
    () => speakerName.trim().length > 1 && agreed,
    [speakerName, agreed],
  );

  function signConsent() {
    const record: Consent = {
      speakerName: speakerName.trim(),
      signedAt: new Date().toISOString(),
      commercial,
      revocable: true,
    };
    localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
    setConsent(record);
    setStep(2);
  }

  function applyPreset(p: VoicePreset) {
    setExaggeration(p.exaggeration);
    setCfgWeight(p.cfgWeight);
    setTemperature(p.temperature);
    setSpeed(p.speed);
  }

  function revokeConsent() {
    localStorage.removeItem(CONSENT_KEY);
    setConsent(null);
    setUploadedFile(null);
    setHistory([]);
    setStep(1);
    setSpeakerName("");
    setAgreed(false);
    setCommercial(false);
  }

  async function handleFile(file: File) {
    setUploadError(null);
    setUploadingName(file.name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || "Upload failed");
      }
      setUploadedFile(file.name);
      setStep(3);
      await fetch("/api/load-multilingual", { method: "POST" }).catch(() => {});
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingName(null);
    }
  }

  async function generate() {
    if (!uploadedFile) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice_mode: "clone",
          reference_audio_filename: uploadedFile,
          language,
          output_format: "wav",
          exaggeration,
          cfg_weight: cfgWeight,
          temperature,
          speed_factor: speed,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t.slice(0, 200) || `Generation failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const gen: Generation = {
        id: crypto.randomUUID(),
        text,
        language,
        voiceFile: uploadedFile,
        url,
        createdAt: new Date().toISOString(),
      };
      setHistory((h) => [gen, ...h].slice(0, 10));
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10 sm:px-10 sm:py-16">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-sky-300 bg-clip-text text-transparent">
              PolyVoice
            </span>
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Consent-first voice cloning · 23+ languages · open-source engine
          </p>
        </div>
        <ServerBadge status={serverStatus} />
      </header>

      <Stepper step={step} hasConsent={!!consent} hasUpload={!!uploadedFile} />

      {step === 1 && !consent && (
        <section className="glass rounded-2xl p-6 sm:p-8">
          <h2 className="text-xl font-semibold">Step 1 · Sign digital consent</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Voice is biometric data. Cloning a voice without explicit consent is
            illegal in the EU (GDPR), California (AB 730), and Tennessee (ELVIS
            Act). Sign this record before uploading a sample.
          </p>

          <label className="mt-6 block text-sm font-medium">
            Speaker&apos;s full legal name
            <input
              value={speakerName}
              onChange={(e) => setSpeakerName(e.target.value)}
              placeholder="e.g., Lakshmi Lakkireddy"
              className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 outline-none focus:border-violet-400"
            />
          </label>

          <label className="mt-4 flex items-start gap-3 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 h-4 w-4 accent-violet-400"
            />
            <span>
              I am the speaker (or have written permission from them). I consent
              to creating a synthetic clone of this voice for use within
              PolyVoice. I can revoke this consent at any time, which deletes
              the voice model.
            </span>
          </label>

          <label className="mt-3 flex items-start gap-3 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={commercial}
              onChange={(e) => setCommercial(e.target.checked)}
              className="mt-1 h-4 w-4 accent-violet-400"
            />
            <span>
              I also consent to commercial use of generated audio. (Leave
              unchecked for personal use only.)
            </span>
          </label>

          <button
            disabled={!ready}
            onClick={signConsent}
            className="mt-6 rounded-full bg-violet-500 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-violet-500/30 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:bg-zinc-700"
          >
            Sign consent
          </button>
        </section>
      )}

      {consent && (
        <section className="glass rounded-2xl p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">
                {step === 2
                  ? "Step 2 · Upload voice sample"
                  : "Step 3 · Generate"}
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Consent on record for{" "}
                <span className="text-zinc-300">{consent.speakerName}</span>,
                signed {new Date(consent.signedAt).toLocaleString()} ·{" "}
                {consent.commercial ? "commercial allowed" : "personal use"}
              </p>
            </div>
            <button
              onClick={revokeConsent}
              className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-200 hover:underline"
            >
              Revoke consent
            </button>
          </div>

          {step === 2 && (
            <div className="mt-6">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) void handleFile(f);
                }}
                onClick={() => fileInput.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-900/40 px-6 py-10 text-center transition hover:border-violet-400"
              >
                <div className="text-3xl">🎙️</div>
                <p className="mt-2 text-sm font-medium">
                  Drop a WAV or MP3 sample (10–30s of clean speech)
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Or click to pick a file
                </p>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".wav,.mp3,audio/wav,audio/mpeg"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
              </div>
              {uploadingName && (
                <p className="mt-3 text-sm text-zinc-400">
                  Uploading {uploadingName}…
                </p>
              )}
              {uploadError && (
                <p className="mt-3 text-sm text-red-400">{uploadError}</p>
              )}
            </div>
          )}

          {step === 3 && uploadedFile && (
            <div className="mt-6 space-y-5">
              <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
                <span className="rounded-full bg-zinc-800 px-3 py-1">
                  Voice: <span className="font-mono">{uploadedFile}</span>
                </span>
                <button
                  onClick={() => {
                    setUploadedFile(null);
                    setStep(2);
                  }}
                  className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-200 hover:underline"
                >
                  Use different sample
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium">Language</label>
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {LANGUAGES.map((l) => (
                    <button
                      key={l.code}
                      onClick={() => setLanguage(l.code)}
                      className={`rounded-lg border px-2 py-2 text-xs transition ${
                        language === l.code
                          ? "border-violet-400 bg-violet-500/10 text-violet-200"
                          : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600"
                      }`}
                    >
                      <span className="mr-1">{l.flag}</span>
                      {l.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium">
                  Text to speak
                </label>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={5}
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm outline-none focus:border-violet-400"
                  placeholder="Type or paste any text…"
                />
                <p className="mt-1 text-xs text-zinc-500">
                  {text.length} chars · roughly {Math.max(1, Math.round(text.length / 15))}s of audio
                </p>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((s) => !s)}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-zinc-300"
                >
                  <span>⚙️ Voice settings</span>
                  <span className="text-xs text-zinc-500">
                    {showAdvanced ? "Hide" : "Show"}
                  </span>
                </button>
                {showAdvanced && (
                  <div className="space-y-4 border-t border-zinc-800 px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      {VOICE_PRESETS.map((p) => (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() => applyPreset(p)}
                          className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 transition hover:border-violet-400 hover:text-violet-200"
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Slider
                        label="Expressiveness"
                        value={exaggeration}
                        min={0.25}
                        max={2}
                        step={0.05}
                        onChange={setExaggeration}
                        hint="Higher = more emotion & emphasis"
                      />
                      <Slider
                        label="Stability"
                        value={cfgWeight}
                        min={0.2}
                        max={1}
                        step={0.05}
                        onChange={setCfgWeight}
                        hint="Higher = steadier, less drift"
                      />
                      <Slider
                        label="Temperature"
                        value={temperature}
                        min={0.1}
                        max={1.5}
                        step={0.05}
                        onChange={setTemperature}
                        hint="Higher = more variation"
                      />
                      <Slider
                        label="Speed"
                        value={speed}
                        min={0.5}
                        max={2}
                        step={0.05}
                        onChange={setSpeed}
                        hint="1.0 = normal pace"
                      />
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={generate}
                disabled={generating || text.trim().length === 0}
                className="rounded-full bg-violet-500 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-violet-500/30 transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:bg-zinc-700"
              >
                {generating ? "Generating…" : "Generate speech"}
              </button>
              {generateError && (
                <p className="text-sm text-red-400">{generateError}</p>
              )}
            </div>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="glass rounded-2xl p-6 sm:p-8">
          <h2 className="text-xl font-semibold">Generated audio</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Audio lives in your browser only — refresh clears it.
          </p>
          <ul className="mt-5 space-y-4">
            {history.map((g) => {
              const lang = LANGUAGES.find((l) => l.code === g.language);
              return (
                <li
                  key={g.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <span>{lang?.flag} {lang?.name}</span>
                    <span>·</span>
                    <span className="font-mono">{g.voiceFile}</span>
                    <span>·</span>
                    <span>{new Date(g.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-zinc-200">
                    {g.text}
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <audio src={g.url} controls className="w-full max-w-md" />
                    <a
                      href={g.url}
                      download={`polyvoice-${g.id.slice(0, 8)}.wav`}
                      className="text-xs text-violet-300 underline-offset-4 hover:underline"
                    >
                      Download
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <footer className="mt-auto pt-10 text-center text-xs text-zinc-600">
        Built on Chatterbox-TTS · React 19 · Next.js 16 · Tailwind v4
      </footer>
    </main>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-zinc-300">{label}</label>
        <span className="text-xs tabular-nums text-violet-300">
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-1 w-full accent-violet-400"
      />
      {hint && <p className="mt-0.5 text-[10px] text-zinc-600">{hint}</p>}
    </div>
  );
}

function ServerBadge({ status }: { status: ServerStatus }) {
  const map = {
    checking: { dot: "bg-zinc-500", label: "Checking engine…" },
    online: { dot: "bg-emerald-400", label: "Engine online" },
    offline: { dot: "bg-red-500", label: "Engine offline" },
  } as const;
  const { dot, label } = map[status];
  return (
    <div className="glass flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-zinc-300">
      <span className={`h-2 w-2 rounded-full ${dot} animate-pulse`} />
      {label}
    </div>
  );
}

function Stepper({
  step,
  hasConsent,
  hasUpload,
}: {
  step: number;
  hasConsent: boolean;
  hasUpload: boolean;
}) {
  const items = [
    { n: 1, label: "Consent", done: hasConsent },
    { n: 2, label: "Sample", done: hasUpload },
    { n: 3, label: "Generate", done: false },
  ];
  return (
    <ol className="flex items-center gap-3 text-sm">
      {items.map((it, i) => {
        const active = step === it.n;
        return (
          <li key={it.n} className="flex items-center gap-3">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${
                it.done
                  ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
                  : active
                  ? "border-violet-400 bg-violet-500/10 text-violet-200"
                  : "border-zinc-700 text-zinc-500"
              }`}
            >
              {it.done ? "✓" : it.n}
            </span>
            <span className={active ? "text-zinc-100" : "text-zinc-500"}>
              {it.label}
            </span>
            {i < items.length - 1 && (
              <span className="mx-1 h-px w-8 bg-zinc-700" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
