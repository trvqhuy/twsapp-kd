import asyncio
from datetime import datetime

from ib_async import IB


DATA_TYPE_MAP = {
    "live": 1,
    "frozen": 2,
    "delayed": 3,
    "delayed_frozen": 4
}


class IBClient:
    def __init__(self, config, events) -> None:
        self.config = config
        self.events = events
        self.ib = IB()
        self.state = {
            "state": "STOPPED",
            "connected": False,
            "message": "",
            "lastError": "",
            "accountId": "",
            "dataType": config.ib.dataType,
            "serverTime": None
        }
        self._connect_lock = asyncio.Lock()
        self._reconnect_task = None

        self.ib.disconnectedEvent += self._on_disconnected
        self.ib.errorEvent += self._on_error

    def status(self) -> dict:
        connected = self.ib.isConnected()
        if connected and self.state.get("state") != "CONNECTED":
            self.state["state"] = "CONNECTED"
            self.state["connected"] = True
            self.state["message"] = "Connected"
        if not connected and self.state.get("connected"):
            self.state["state"] = "DISCONNECTED"
            self.state["connected"] = False
        return dict(self.state)

    def get_accounts(self) -> list:
        if not self.ib.isConnected():
            return []
        try:
            return list(self.ib.managedAccounts() or [])
        except Exception:
            return []

    async def connect(self) -> bool:
        async with self._connect_lock:
            if self.ib.isConnected():
                return True
            self._set_state("CONNECTING", "Connecting to IBKR...")
            self.events.emit_sync(
                "backend_log",
                {
                    "level": "info",
                    "message": f"Connecting to IBKR at {self.config.ib.host}:{self.config.ib.port}"
                }
            )
            try:
                await self.ib.connectAsync(
                    self.config.ib.host,
                    self.config.ib.port,
                    clientId=self.config.ib.clientId
                )
                if not self.ib.isConnected():
                    self._set_state("ERROR", "IBKR connection failed.")
                    self._schedule_reconnect()
                    return False
                self._set_state("CONNECTED", "Connected")
                self.events.emit_sync("backend_log", {"level": "info", "message": "IBKR connected."})
                self.ib.reqMarketDataType(DATA_TYPE_MAP.get(self.config.ib.dataType, 3))
                await self._refresh_account_id()
                await self._refresh_server_time()
                return True
            except Exception as exc:
                self._set_state("ERROR", f"Connection error: {exc}")
                self._schedule_reconnect()
                return False

    async def disconnect(self) -> None:
        async with self._connect_lock:
            if self.ib.isConnected():
                self.ib.disconnect()
            self._set_state("DISCONNECTED", "Disconnected")
            self.events.emit_sync("backend_log", {"level": "info", "message": "IBKR disconnected."})

    async def reconnect(self) -> bool:
        await self.disconnect()
        await asyncio.sleep(0.2)
        return await self.connect()

    async def ensure_connected(self) -> None:
        if not self.ib.isConnected():
            connected = await self.connect()
            if not connected:
                raise RuntimeError("IBKR not connected")

    def update_config(self, config) -> None:
        self.config = config
        self.state["dataType"] = config.ib.dataType
        self.events.emit_sync("status_update", self.status())

    async def _refresh_account_id(self) -> None:
        account_id = self.config.ib.accountId
        if not account_id:
            accounts = self.ib.managedAccounts()
            account_id = accounts[0] if accounts else ""
        self.state["accountId"] = account_id
        self.events.emit_sync("status_update", self.status())

    async def _refresh_server_time(self) -> None:
        try:
            server_time = await self.ib.reqCurrentTimeAsync()
            if server_time:
                self.state["serverTime"] = server_time.isoformat()
        except Exception:
            self.state["serverTime"] = datetime.utcnow().isoformat()
        self.events.emit_sync("status_update", self.status())

    def _set_state(self, state: str, message: str) -> None:
        self.state["state"] = state
        self.state["connected"] = state == "CONNECTED"
        self.state["message"] = message
        if state != "ERROR":
            self.state["lastError"] = ""
        self.events.emit_sync("status_update", self.status())

    def _on_disconnected(self) -> None:
        self.state["connected"] = False
        self.state["state"] = "DISCONNECTED"
        self.state["message"] = "Disconnected"
        self.events.emit_sync("status_update", self.status())
        self._schedule_reconnect()

    def _on_error(self, req_id, error_code, error_string, contract=None) -> None:
        message = f"{error_code}: {error_string}"
        info_codes = {2104, 2106, 2107, 2108, 2158}
        if error_code in info_codes:
            self.events.emit_sync("backend_log", {"level": "info", "message": message})
            return
        self.state["lastError"] = message
        if error_code in {1100, 1101, 1102}:
            self.state["state"] = "ERROR"
            self.state["connected"] = False
            self._schedule_reconnect()
        self.events.emit_sync("backend_log", {"level": "error", "message": message})
        self.events.emit_sync("status_update", self.status())

    def _schedule_reconnect(self) -> None:
        if not self.config.ib.autoReconnect:
            return
        if self._reconnect_task and not self._reconnect_task.done():
            return

        async def _reconnect() -> None:
            await asyncio.sleep(max(1, self.config.ib.reconnectDelaySec))
            if not self.ib.isConnected():
                await self.connect()

        self._reconnect_task = asyncio.create_task(_reconnect())
