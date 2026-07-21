from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Barcode Replacement API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

from routes import router
app.include_router(router)

@app.get("/api/health")
def health():
    return {"status": "ok"}
