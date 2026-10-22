import json
import asyncio
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from auth import get_current_user
import logger as log_store

router = APIRouter(prefix="/api/events", tags=["events"], dependencies=[Depends(get_current_user)])


@router.get("/stream")
async def stream_events():
    async def generate():
        async for event in log_store.subscribe():
            yield f"data: {json.dumps(event)}\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream",
                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/history")
async def get_history():
    return log_store.get_history()
