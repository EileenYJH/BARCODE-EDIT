"""Download the SAM2 tiny checkpoint into services/api/models/.

Usage: python scripts/download_sam2_checkpoint.py
"""
import os
import sys
import urllib.request
from pathlib import Path

# Verify this URL against https://github.com/facebookresearch/sam2's
# download_ckpts.sh before relying on it -- Meta's hosting paths have
# changed between SAM2 releases.
CHECKPOINT_URL = "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt"
MODELS_DIR = Path(os.environ.get("SAM2_MODELS_DIR", Path(__file__).resolve().parent.parent / "models"))
DEST = MODELS_DIR / "sam2.1_hiera_tiny.pt"


def main() -> int:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    if DEST.exists():
        print(f"already downloaded: {DEST}")
        return 0
    print(f"downloading {CHECKPOINT_URL} -> {DEST}")
    urllib.request.urlretrieve(CHECKPOINT_URL, DEST)
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
