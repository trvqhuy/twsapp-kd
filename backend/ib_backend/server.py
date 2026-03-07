import argparse
import asyncio
import json
import logging
from pathlib import Path

import websockets

from .config import load_config, save_config, validate_config, config_to_dict, update_config
from .events import EventBus
from .ib_client import IBClient
from .market_data import MarketDataService
from .options_chain import OptionsChainService
from .portfolio import PortfolioService
from .execution import ExecutionService


class ClientConnection:
    def __init__(self, websocket):
        self.websocket = websocket

    async def send_json(self, payload: dict) -> None:
        await self.websocket.send(json.dumps(payload))


class BackendService:
    def __init__(self, config_path: str) -> None:
        self.config_path = config_path
        self.config = load_config(config_path)
        self.events = EventBus()
        self.ib_client = IBClient(self.config, self.events)
        self.market_data = MarketDataService(self.ib_client, self.events)
        self.options_chain = OptionsChainService(self.ib_client, self.market_data, self.events)
        self.portfolio = PortfolioService(self.ib_client, self.market_data, self.options_chain)
        self.execution = ExecutionService(self.ib_client, self.events)
        self._connect_task = None
        self._status_task = None

    async def start(self) -> None:
        if self.config.ib.autoConnect:
            self._connect_task = asyncio.create_task(self.ib_client.connect())
        if not self._status_task:
            self._status_task = asyncio.create_task(self._status_loop())

    async def _status_loop(self) -> None:
        while True:
            await self.events.emit("status_update", self.ib_client.status())
            await asyncio.sleep(2)

    async def handle_request(self, method: str, params: dict):
        if method == "control.get_status":
            return self.ib_client.status()
        if method == "control.get_config":
            return config_to_dict(self.config)
        if method == "control.get_accounts":
            return {"accounts": self.ib_client.get_accounts()}
        if method == "control.get_strategies":
            return {"strategies": list(self.config.strategies or [])}
        if method == "control.set_strategies":
            strategies = params.get("strategies", [])
            if not isinstance(strategies, list):
                raise ValueError("Strategies must be a list")
            self.config = update_config(self.config, {"strategies": strategies})
            save_config(self.config_path, self.config)
            return {"ok": True}
        if method == "control.validate_config":
            draft = params.get("config")
            if draft:
                candidate = update_config(self.config, draft)
                return {"errors": validate_config(candidate)}
            return {"errors": validate_config(self.config)}
        if method == "control.set_config":
            updates = params.get("config", {})
            apply_now = params.get("apply", False)
            candidate = update_config(self.config, updates)
            errors = validate_config(candidate)
            if errors:
                return {"errors": errors}
            self.config = candidate
            save_config(self.config_path, self.config)
            self.ib_client.update_config(self.config)
            await self.events.emit("config_update", config_to_dict(self.config))
            if apply_now:
                await self.ib_client.reconnect()
            return {"errors": []}
        if method == "control.connect":
            connected = await self.ib_client.connect()
            return {"connected": connected}
        if method == "control.disconnect":
            await self.ib_client.disconnect()
            return {"connected": False}
        if method == "control.reconnect":
            connected = await self.ib_client.reconnect()
            return {"connected": connected}

        if method == "market.subscribe":
            symbols = params.get("symbols", [])
            await self.market_data.subscribe(symbols)
            return {"subscribed": symbols}
        if method == "market.unsubscribe":
            symbols = params.get("symbols", [])
            await self.market_data.unsubscribe(symbols)
            return {"unsubscribed": symbols}
        if method == "market.get_last_price":
            symbol = params.get("symbol")
            return {"price": self.market_data.get_last_price(symbol) if symbol else None}

        if method == "options.select_by_premium":
            selection = await self.options_chain.select_by_premium(
                params["symbol"],
                params["side"],
                float(params["targetPremium"]),
                int(params.get("minDaysOut", 25))
            )
            return selection
        if method == "options.get_premium":
            premium = await self.options_chain.get_option_premium(
                params["symbol"],
                params["expiry"],
                float(params["strike"]),
                params["side"]
            )
            return {"premium": premium}

        if method == "portfolio.get_account_summary":
            return await self.portfolio.get_account_summary()
        if method == "portfolio.get_positions":
            return await self.portfolio.get_positions()
        if method == "portfolio.get_orders":
            return await self.portfolio.get_orders()

        if method == "execution.submit":
            order_id = await self.execution.submit_order(params)
            return {"orderId": order_id}
        if method == "execution.cancel":
            await self.execution.cancel_order(params["orderId"])
            return {"ok": True}

        raise ValueError(f"Unknown method: {method}")


async def handler(websocket, service: BackendService):
    client = ClientConnection(websocket)
    service.events.register(client)
    try:
        async for message in websocket:
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            request_id = payload.get("id")
            method = payload.get("method")
            params = payload.get("params") or {}
            if not method:
                continue
            try:
                result = await service.handle_request(method, params)
                if request_id is not None:
                    await client.send_json({"id": request_id, "result": result})
            except Exception as exc:
                if request_id is not None:
                    await client.send_json({"id": request_id, "error": {"message": str(exc)}})
    finally:
        service.events.unregister(client)


async def main() -> None:
    logging.getLogger("websockets.server").setLevel(logging.CRITICAL)
    logging.getLogger("websockets.protocol").setLevel(logging.CRITICAL)
    parser = argparse.ArgumentParser(description="Hybrid Bot IBKR backend")
    parser.add_argument("--config", required=True, help="Path to config JSON file")
    parser.add_argument("--host", default=None, help="Backend host override")
    parser.add_argument("--port", type=int, default=None, help="Backend port override")
    args = parser.parse_args()

    config_path = str(Path(args.config).expanduser())
    service = BackendService(config_path)
    if args.host:
        service.config.backend.host = args.host
    if args.port:
        service.config.backend.port = args.port
    save_config(config_path, service.config)

    await service.start()

    host = service.config.backend.host
    port = service.config.backend.port
    async with websockets.serve(lambda ws: handler(ws, service), host, port):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
