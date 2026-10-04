#!/usr/bin/env bash
# Bug reports sent from the app's "Report a bug" window, which the relay on
# `vm` keeps in ~/latex4all-relay/data/reports/ (see apps/relay/reports.mjs).
#
#   scripts/bug-reports.sh            copy new ones here and list them all
#   scripts/bug-reports.sh <id>       show one: text, details, recent errors
#
# Copies go to ~/Latex4All-bug-reports (one folder per report, with its
# screenshots). Nothing is deleted on the server.
set -euo pipefail
DEST="${BUG_REPORTS_DIR:-$HOME/Latex4All-bug-reports}"
mkdir -p "$DEST"
ssh vm "tar -C latex4all-relay/data/reports -cf - ." | tar -C "$DEST" -xf -

if [[ $# -ge 1 ]]; then
  dir="$DEST/$1"
  python3 - "$dir" <<'PY'
import json, sys, os
d = sys.argv[1]
r = json.load(open(os.path.join(d, "report.json")))
print(f"{r['at']}  {r.get('contact') or '(no contact)'}")
print(" · ".join(f"{k}: {v}" for k, v in (r.get("app") or {}).items()))
print("\n" + r["text"] + "\n")
for img in r.get("images", []):
    print("image:", os.path.join(d, img))
if r.get("log"):
    print("\nRecent warnings and errors:\n" + r["log"])
PY
  exit 0
fi

python3 - "$DEST" <<'PY'
import json, sys, os
root = sys.argv[1]
ids = sorted(n for n in os.listdir(root) if os.path.isfile(os.path.join(root, n, "report.json")))
if not ids:
    print("No reports yet.")
for i in ids:
    r = json.load(open(os.path.join(root, i, "report.json")))
    first = r["text"].strip().splitlines()[0][:90]
    pics = f" [{len(r.get('images', []))} img]" if r.get("images") else ""
    print(f"{i}  v{(r.get('app') or {}).get('version', '?')}{pics}  {first}")
PY
