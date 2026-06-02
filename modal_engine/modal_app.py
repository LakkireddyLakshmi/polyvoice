"""
PolyVoice engine on Modal — serverless GPU.

Serves the same HTTP endpoints the PolyVoice frontend already calls
(/api/ui/initial-data, /get_reference_files, /upload_reference,
/load_multilingual_model, /tts), so the Next.js app works unchanged: just
point CHATTERBOX_URL at the deployed https://...modal.run URL.

Deploy:   modal deploy modal_app.py
Reuses the proven engine.py from the Chatterbox-TTS-Server repo (the same one
the Kaggle demo used), loaded on a GPU once per container.
"""
import os
import modal

REPO_URL = (
    "https://github.com/mirbehnam/"
    "Chatterbox-TTS-Server-windows-easyInstallation.git"
)
CHATTERBOX_FORK = (
    "git+https://github.com/mirbehnam/chatterbox.git"
    "@3e8903e45a836bcee3dbf83aaf02c36bbb6df654"
)
REPO_DIR = "/engine"
REF_DIR = "/refs"
CACHE_DIR = "/cache"

app = modal.App("polyvoice-engine")

# Image: same install recipe proven on Kaggle GPU. Pin the CUDA torch trio +
# transformers LAST with --no-deps so the chatterbox fork can't downgrade them.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "wget", "ffmpeg", "libsndfile1")
    .pip_install(CHATTERBOX_FORK)
    .pip_install(
        "fastapi",
        "python-multipart",
        "soundfile",
        "librosa",
        "safetensors",
        "pyyaml",
        "unidecode",
        "inflect",
        "pydub",
        "audiotsm",
        "requests",
        "jinja2",
        "aiofiles",
        "watchdog",
        "tqdm",
    )
    .pip_install(
        "torch==2.6.0",
        "torchvision==0.21.0",
        "torchaudio==2.6.0",
        index_url="https://download.pytorch.org/whl/cu124",
        extra_options="--force-reinstall --no-deps",
    )
    .pip_install(
        "transformers==4.46.3",
        "tokenizers==0.20.3",
        "numpy==1.26.0",
        extra_options="--force-reinstall --no-deps",
    )
    .run_commands(f"git clone --depth 1 {REPO_URL} {REPO_DIR}")
    .env({"HF_HOME": CACHE_DIR, "HF_HUB_DISABLE_SYMLINKS_WARNING": "1"})
)

# Persistent volumes: HF model weights (downloaded once) + uploaded reference clips.
hf_cache = modal.Volume.from_name("polyvoice-hf-cache", create_if_missing=True)
refs_vol = modal.Volume.from_name("polyvoice-refs", create_if_missing=True)


@app.cls(
    gpu="A10G",
    image=image,
    volumes={CACHE_DIR: hf_cache, REF_DIR: refs_vol},
    scaledown_window=300,  # stay warm 5 min after the last request
    timeout=900,  # allow the first cold download (~3-5 min)
)
class Engine:
    @modal.enter()
    def load(self):
        import sys
        import yaml

        os.makedirs(REF_DIR, exist_ok=True)
        os.makedirs(os.path.join(REPO_DIR, "logs"), exist_ok=True)
        sys.path.insert(0, REPO_DIR)
        os.chdir(REPO_DIR)

        # Point the engine config at the GPU.
        with open("config.yaml") as f:
            cfg = yaml.safe_load(f)
        cfg["tts_engine"]["device"] = "cuda"
        cfg["server"]["log_file_path"] = "logs/tts_server.log"
        with open("config.yaml", "w") as f:
            yaml.safe_dump(cfg, f, sort_keys=False)

        import engine

        engine.model_device = "cuda"
        ok = engine.load_multilingual_model()
        assert ok, "multilingual model failed to load"
        self.engine = engine
        hf_cache.commit()  # persist the downloaded weights for the next container
        print("PolyVoice engine ready on GPU.")

    @modal.asgi_app()
    def web(self):
        import io
        import soundfile as sf
        from fastapi import FastAPI, File, Request, UploadFile
        from fastapi.responses import JSONResponse, StreamingResponse

        engine = self.engine
        api = FastAPI(title="PolyVoice Engine")

        @api.get("/")
        def root():
            # Friendly health page so visiting the bare URL isn't a scary 404.
            return {
                "service": "PolyVoice engine",
                "status": "running",
                "gpu": "ready",
                "endpoints": ["/tts", "/upload_reference", "/get_reference_files"],
            }

        @api.get("/api/ui/initial-data")
        def initial_data():
            # PolyVoice's /api/status just checks this responds 200.
            return {"status": "ready", "engine": "chatterbox-multilingual"}

        @api.get("/get_reference_files")
        def get_reference_files():
            refs_vol.reload()
            return [
                f
                for f in sorted(os.listdir(REF_DIR))
                if f.lower().endswith((".wav", ".mp3"))
            ]

        @api.post("/upload_reference")
        async def upload_reference(files: list[UploadFile] = File(...)):
            saved = []
            for f in files:
                name = os.path.basename(f.filename or "sample.wav")
                with open(os.path.join(REF_DIR, name), "wb") as out:
                    out.write(await f.read())
                saved.append(name)
            refs_vol.commit()
            return {"message": "Files uploaded successfully", "uploaded_files": saved}

        @api.post("/load_multilingual_model")
        def load_multilingual_model():
            # Already loaded in @modal.enter; report success.
            return {"status": "ok", "message": "Multilingual model is loaded."}

        @api.post("/tts")
        async def tts(request: Request):
            body = await request.json()
            text = (body.get("text") or "").strip()
            if not text:
                return JSONResponse({"error": "text is required"}, status_code=400)

            ref_path = None
            ref_name = body.get("reference_audio_filename")
            if ref_name:
                refs_vol.reload()
                cand = os.path.join(REF_DIR, os.path.basename(ref_name))
                if os.path.isfile(cand):
                    ref_path = cand
                else:
                    return JSONResponse(
                        {"error": f"reference '{ref_name}' not found"},
                        status_code=404,
                    )

            def _f(key, default):
                v = body.get(key)
                return float(v) if v is not None else default

            wav, sr = engine.synthesize(
                text=text,
                audio_prompt_path=ref_path,
                temperature=_f("temperature", 0.8),
                exaggeration=_f("exaggeration", 0.5),
                cfg_weight=_f("cfg_weight", 0.5),
                seed=int(body.get("seed") or 0),
                language=body.get("language") or "en",
            )
            if wav is None:
                return JSONResponse({"error": "synthesis failed"}, status_code=500)

            arr = wav.squeeze().detach().cpu().numpy()
            buf = io.BytesIO()
            sf.write(buf, arr, sr, format="WAV")
            buf.seek(0)
            return StreamingResponse(buf, media_type="audio/wav")

        return api
