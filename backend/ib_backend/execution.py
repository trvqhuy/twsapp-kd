from ib_async import MarketOrder, Option


class ExecutionService:
    def __init__(self, ib_client, events) -> None:
        self.ib_client = ib_client
        self.events = events
        self.trades = {}
        self.order_meta = {}

        self.ib_client.ib.orderStatusEvent += self._on_order_status

    async def submit_order(self, order_request: dict) -> str:
        await self.ib_client.ensure_connected()
        option = order_request.get("option")
        if not option:
            raise RuntimeError("Option details required for order")
        contract = Option(
            order_request["symbol"],
            self._normalize_expiry(option["expiry"]),
            float(option["strike"]),
            self._map_right(option["side"]),
            "SMART",
            "USD"
        )
        await self._qualify(contract)
        action = "BUY" if order_request["side"] == "BUY" else "SELL"
        order = MarketOrder(action, float(order_request["quantity"]))
        trade = self.ib_client.ib.placeOrder(contract, order)
        order_id = trade.order.orderId
        self.trades[order_id] = trade
        self.order_meta[order_id] = {
            "playId": order_request.get("playId"),
            "symbol": order_request["symbol"],
            "side": action,
            "quantity": order_request["quantity"],
            "option": option
        }
        self.events.emit_sync("execution_event", {
            "type": "submitted",
            "order": self._build_order_payload(order_id, trade)
        })
        return str(order_id)

    async def cancel_order(self, order_id: str) -> None:
        await self.ib_client.ensure_connected()
        order_id_int = int(order_id)
        trade = self.trades.get(order_id_int)
        if trade:
            self.ib_client.ib.cancelOrder(trade.order)
        self.events.emit_sync("execution_event", {"type": "canceled", "orderId": str(order_id)})

    def _on_order_status(self, trade, *_args) -> None:
        order_id = trade.order.orderId
        status = trade.orderStatus.status
        payload = self._build_order_payload(order_id, trade)
        if status.lower() == "filled":
            event_type = "filled"
        elif status.lower() == "cancelled":
            event_type = "canceled"
        else:
            event_type = "updated"
        self.events.emit_sync("execution_event", {"type": event_type, "order": payload})

    def _build_order_payload(self, order_id, trade):
        meta = self.order_meta.get(order_id, {})
        contract = trade.contract
        option_payload = meta.get("option")
        return {
            "id": str(order_id),
            "playId": meta.get("playId"),
            "symbol": contract.symbol,
            "side": meta.get("side", trade.order.action),
            "quantity": meta.get("quantity", trade.order.totalQuantity),
            "status": trade.orderStatus.status,
            "filledQty": trade.orderStatus.filled,
            "avgFillPrice": trade.orderStatus.avgFillPrice,
            "option": option_payload
        }

    @staticmethod
    def _map_right(side: str) -> str:
        side = (side or "").upper()
        if side in {"CALL", "C"}:
            return "C"
        return "P"

    @staticmethod
    def _normalize_expiry(expiry: str) -> str:
        if not expiry:
            return expiry
        return expiry.replace("-", "")

    async def _qualify(self, *contracts):
        if hasattr(self.ib_client.ib, "qualifyContractsAsync"):
            await self.ib_client.ib.qualifyContractsAsync(*contracts)
        else:
            self.ib_client.ib.qualifyContracts(*contracts)
