import tempfile, os, glob, json
from kaggle.api.kaggle_api_extended import KaggleApi

api = KaggleApi(); api.authenticate()
d = tempfile.mkdtemp()
# file_pattern is a REGEX in this CLI version; grab only the .log
api.kernels_output("lakshmilakkireddy/polyvoice-tts-demo", d, quiet=True,
                   file_pattern=r".*\.log")
logs = glob.glob(os.path.join(d, "*.log"))
if not logs:
    print("NO LOG FOUND"); raise SystemExit
txt = open(logs[0], encoding="utf-8", errors="replace").read()
try:
    entries = json.loads(txt)
    out = "".join(e.get("data", "") for e in entries)
except Exception:
    out = txt
print(out[-5000:])
