import asyncio


class EventBus:
    def __init__(self) -> None:
        self._clients = set()

    def register(self, websocket) -> None:
        self._clients.add(websocket)

    def unregister(self, websocket) -> None:
        if websocket in self._clients:
            self._clients.remove(websocket)

    async def emit(self, event: str, data: dict) -> None:
        if not self._clients:
            return
        payload = {"event": event, "data": data}
        await asyncio.gather(
            *[client.send_json(payload) for client in list(self._clients)],
            return_exceptions=True
        )

    def emit_sync(self, event: str, data: dict) -> None:
        asyncio.create_task(self.emit(event, data))
