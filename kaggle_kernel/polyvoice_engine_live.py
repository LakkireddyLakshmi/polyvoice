# PolyVoice LIVE engine on Kaggle GPU.
# Runs the Chatterbox FastAPI server and exposes it on a public cloudflared URL,
# then broadcasts that URL to ntfy.sh so it can be retrieved headlessly (Kaggle
# batch kernels don't expose logs while still running). Keep this kernel RUNNING
# to keep the engine alive; it self-stops after ~8 hours.
import os, sys, time, subprocess, re, threading, urllib.request

NTFY_TOPIC = "polyvoice-eng-lakshmi-k7m2qz"  # unguessable relay topic
WORK = "/kaggle/working"
REPO = WORK + "/engine"
CF = WORK + "/cloudflared"


def post_ntfy(msg):
    try:
        req = urllib.request.Request(
            "https://ntfy.sh/" + NTFY_TOPIC, data=str(msg).encode(), method="POST"
        )
        urllib.request.urlopen(req, timeout=15).read()
        print("[ntfy] posted:", msg)
    except Exception as e:
        print("[ntfy] post failed:", e)


post_ntfy("STATUS: installing")

print(">>> Cloning engine repo...")
os.system(
    "git clone -q https://github.com/mirbehnam/"
    "Chatterbox-TTS-Server-windows-easyInstallation.git " + REPO
)

print(">>> Installing chatterbox multilingual fork + server deps...")
os.system(
    "pip install -q git+https://github.com/mirbehnam/chatterbox.git"
    "@3e8903e45a836bcee3dbf83aaf02c36bbb6df654"
)
os.system(
    "pip install -q fastapi 'uvicorn[standard]' soundfile librosa safetensors "
    "python-multipart requests jinja2 aiofiles unidecode inflect tqdm pydub "
    "audiotsm watchdog pyyaml"
)
print(">>> Pinning torch CUDA trio + transformers (Kaggle-known-good)...")
os.system(
    "pip install -q --force-reinstall --no-deps torch==2.6.0 torchvision==0.21.0 "
    "torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124"
)
os.system(
    "pip install -q --force-reinstall --no-deps "
    "transformers==4.46.3 tokenizers==0.20.3 numpy==1.26.0"
)

import torch, torchvision
_ = torchvision.ops.nms  # raises if the C++ ops failed to register
print("torchvision OK:", torchvision.__version__, "| CUDA:", torch.cuda.is_available())

print(">>> Downloading cloudflared...")
if not os.path.exists(CF):
    os.system(
        "wget -q https://github.com/cloudflare/cloudflared/releases/latest/"
        "download/cloudflared-linux-amd64 -O " + CF + " && chmod +x " + CF
    )

# Point the engine config at the GPU before importing it.
os.chdir(REPO)
import yaml

with open("config.yaml") as f:
    cfg = yaml.safe_load(f)
cfg["tts_engine"]["device"] = "cuda" if torch.cuda.is_available() else "cpu"
cfg["server"]["host"] = "0.0.0.0"
cfg["server"]["port"] = 8004
cfg["server"]["log_file_path"] = "logs/tts_server.log"
with open("config.yaml", "w") as f:
    yaml.safe_dump(cfg, f, sort_keys=False)
os.makedirs("logs", exist_ok=True)
sys.path.insert(0, REPO)

print(">>> Starting the FastAPI engine server...")
post_ntfy("STATUS: loading model")
import uvicorn


def run_server():
    from server import app

    uvicorn.run(app, host="0.0.0.0", port=8004, log_level="warning", access_log=False)


threading.Thread(target=run_server, daemon=True).start()

import requests

ready = False
for _ in range(210):  # up to 7 minutes
    try:
        if requests.get("http://localhost:8004/docs", timeout=2).ok:
            ready = True
            break
    except Exception:
        pass
    time.sleep(2)
print("engine up:", ready)
if not ready:
    post_ntfy("ERROR: engine failed to start")
    raise SystemExit("engine failed to start - see traceback above")

print(">>> Opening public cloudflared tunnel...")
proc = subprocess.Popen(
    [CF, "tunnel", "--url", "http://localhost:8004", "--no-autoupdate"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1,
)
public_url = None
for line in proc.stdout:
    print(line, end="")
    m = re.search(r"https://[-a-z0-9]+\.trycloudflare\.com", line)
    if m:
        public_url = m.group(0)
        break

print("\n=========== PUBLIC ENGINE URL ===========")
print(public_url)
print("=========================================")
post_ntfy("URL " + str(public_url))

# Keep the kernel (and therefore the tunnel) alive; re-broadcast the URL every
# 5 minutes so it stays retrievable from the ntfy cache. Self-stops after ~8h.
for i in range(96):  # 96 * 5 min = 8 hours
    time.sleep(300)
    post_ntfy("URL " + str(public_url) + " (alive " + str((i + 1) * 5) + "m)")
