# PolyVoice - multilingual voice-cloning proof on Kaggle GPU.
# Reuses the tested engine.py from the Chatterbox server repo (incl. the eager-attention patch).
import os, sys, time, glob, traceback

REPO = "/kaggle/working/engine"
OUT = "/kaggle/working"

print(">>> Cloning engine repo...")
os.system(
    "git clone -q https://github.com/mirbehnam/"
    "Chatterbox-TTS-Server-windows-easyInstallation.git " + REPO
)

print(">>> Installing multilingual chatterbox fork (has chatterbox.mtl_tts)...")
# PyPI chatterbox-tts is English-only. The 23-language ChatterboxMultilingualTTS
# lives in this fork/commit (the exact one the local working setup uses).
os.system(
    "pip install -q "
    "git+https://github.com/mirbehnam/chatterbox.git"
    "@3e8903e45a836bcee3dbf83aaf02c36bbb6df654"
)
os.system("pip install -q soundfile")

# chatterbox pulls a torch that mismatches Kaggle's torchvision (causes
# 'operator torchvision::nms does not exist'). Force the exact CUDA trio +
# transformers/numpy that are known-good locally. --no-deps so nothing else moves.
print(">>> Pinning torch/torchvision/torchaudio + transformers to known-good CUDA versions...")
os.system(
    "pip install -q --force-reinstall --no-deps "
    "torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0 "
    "--index-url https://download.pytorch.org/whl/cu124"
)
os.system("pip install -q --force-reinstall --no-deps "
          "transformers==4.46.3 tokenizers==0.20.3 numpy==1.26.0")

# Sanity-check the torch/torchvision pairing BEFORE importing the model stack.
import torchvision
import torch
_ = torchvision.ops.nms  # raises if the C++ ops failed to register
print("torchvision OK:", torchvision.__version__)
print("CUDA available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("GPU:", torch.cuda.get_device_name(0))
else:
    print("WARNING: no CUDA - generation will be very slow. "
          "Enable GPU in kernel settings.")

# Point the engine config at the GPU before importing it.
os.chdir(REPO)
import yaml
with open("config.yaml") as f:
    cfg = yaml.safe_load(f)
cfg["tts_engine"]["device"] = "cuda" if torch.cuda.is_available() else "cpu"
cfg["server"]["log_file_path"] = "logs/tts_server.log"  # forward slashes for Linux
with open("config.yaml", "w") as f:
    yaml.safe_dump(cfg, f, sort_keys=False)
os.makedirs("logs", exist_ok=True)

sys.path.insert(0, REPO)
print(">>> Importing engine and loading the multilingual model on GPU...")
import engine

# Skip the base English model; set the device and load multilingual directly.
engine.model_device = "cuda" if torch.cuda.is_available() else "cpu"
loaded = engine.load_multilingual_model()
print("multilingual model loaded:", loaded)
assert loaded, "Multilingual model failed to load - see traceback above."

# Pick a reference voice that ships with the repo (this is the voice being cloned).
candidates = (
    sorted(glob.glob(f"{REPO}/voices/*.wav"))
    + sorted(glob.glob(f"{REPO}/reference_audio/*.wav"))
    + sorted(glob.glob(f"{REPO}/*.wav"))
)
print("candidate reference voices:", [os.path.basename(c) for c in candidates[:8]])
reference = candidates[0] if candidates else None
print(">>> Cloning reference voice:", reference, "(None = model default voice)")

import soundfile as sf
import base64

# Texts are base64 so this source file stays pure ASCII (the Kaggle CLI on
# Windows can't upload a file containing raw Devanagari/Japanese characters).
_B64 = {
    "en": "SGVsbG8hIFRoaXMgdm9pY2Ugd2FzIGNsb25lZCB3aXRoIGNvbnNlbnQgYW5kIGlzIHNwZWFraW5nIG9uIGEgR1BVLg==",
    "hi": "4KSo4KSu4KS44KWN4KSk4KWHISDgpK/gpLkg4KSG4KS14KS+4KSc4KS8IOCkheCkqOClgeCkruCkpOCkvyDgpJXgpYcg4KS44KS+4KSlIOCkleCljeCksuCli+CkqCDgpJXgpYAg4KSX4KSIIOCkueCliCDgpJTgpLAg4KSc4KWA4KSq4KWA4KSv4KWCIOCkquCksCDgpJrgpLIg4KSw4KS54KWAIOCkueCliOClpA==",
    "es": "wqFIb2xhISBFc3RhIHZveiBmdWUgY2xvbmFkYSBjb24gY29uc2VudGltaWVudG8geSBzZSBlamVjdXRhIGVuIHVuYSBHUFUu",
    "ja": "44GT44KT44Gr44Gh44Gv77yB44GT44Gu5aOw44Gv6Kix5Y+v44KS5b6X44Gm6KSH6KO944GV44KM44CBR1BV5LiK44Gn5YuV5L2c44GX44Gm44GE44G+44GZ44CC",
    "fr": "Qm9uam91ciAhIENldHRlIHZvaXggYSDDqXTDqSBjbG9uw6llIGF2ZWMgY29uc2VudGVtZW50IGV0IGZvbmN0aW9ubmUgc3VyIHVuIEdQVS4=",
}
DEMOS = [(c, base64.b64decode(b).decode("utf-8")) for c, b in _B64.items()]

generated = []
for code, text in DEMOS:
    try:
        t0 = time.time()
        wav, sr = engine.synthesize(
            text=text, audio_prompt_path=reference, language=code, seed=42
        )
        if wav is None:
            print(f"[{code}] FAILED (returned None)")
            continue
        arr = wav.squeeze().detach().cpu().numpy()
        path = f"{OUT}/polyvoice_{code}.wav"
        sf.write(path, arr, sr)
        print(f"[{code}] OK -> {os.path.basename(path)} "
              f"({time.time() - t0:.1f}s, sr={sr}, samples={arr.shape})")
        generated.append(path)
    except Exception as e:
        print(f"[{code}] ERROR: {e}")
        traceback.print_exc()

print("\n=== DONE ===")
print("Generated files:", [os.path.basename(p) for p in generated])
