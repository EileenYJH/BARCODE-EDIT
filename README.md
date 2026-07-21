# Barcode Editor — M1 (CPU Core Pipeline)

Replace a barcode in a photo with a chosen barcode, warped and Poisson-blended
to look printed-on. Classical CPU pipeline (no GPU). See
`docs/superpowers/specs/2026-07-21-barcode-replacement-m1-design.md`.

## Prerequisites
- Python 3.11+ (developed on 3.14), Node 20+ (developed on 24)
- ZBar runtime for pyzbar: Windows wheels bundle it; Linux `apt install libzbar0`; macOS `brew install zbar`.

## Backend (services/api)
```
cd services/api
python -m venv .venv
# Windows: .venv\Scripts\activate    bash: source .venv/bin/activate
pip install -r requirements.txt
python -m pytest            # run tests
uvicorn main:app --reload --port 8000
```

## Frontend (apps/web)
```
cd apps/web
npm install
npm run dev                 # http://localhost:3000
```
The frontend reads `NEXT_PUBLIC_API_BASE` (defaults to http://localhost:8000).

## Flow
Upload an image with a barcode -> the detected region shows draggable corner
handles -> set symbology + value -> Replace -> compare with the before/after
swipe -> download PNG or barcode SVG.

## Pipeline stages (backend)
detect (OpenCV geometry + pyzbar decode) -> generate (python-barcode / qrcode)
-> perspective warp -> tone-match -> Poisson seamlessClone blend -> layers.

## Scope
M1 is the CPU core pipeline. Deferred to later milestones: SAM2 segmentation,
diffusion harmonization, super-resolution, background removal, async queue/DB/S3,
PDF417/Data Matrix, and the full Photoshop-class editor. See the design + plan
docs under `docs/superpowers/`.
