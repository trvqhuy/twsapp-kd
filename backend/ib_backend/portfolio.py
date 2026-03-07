from ib_async import Option


class PortfolioService:
    def __init__(self, ib_client, market_data, options_chain) -> None:
        self.ib_client = ib_client
        self.market_data = market_data
        self.options_chain = options_chain

    async def get_account_summary(self) -> dict:
        await self.ib_client.ensure_connected()
        account_id = self.ib_client.status().get("accountId")
        if not account_id:
            account_id = self._pick_account()
        if hasattr(self.ib_client.ib, "accountSummaryAsync"):
            summary = await self.ib_client.ib.accountSummaryAsync(account_id)
        else:
            summary = self.ib_client.ib.accountSummary(account_id)
        values = {item.tag: item.value for item in summary}

        equity = float(values.get("NetLiquidation", 0) or 0)
        cash = float(values.get("AvailableFunds", values.get("TotalCashValue", 0)) or 0)
        unrealized = float(values.get("UnrealizedPnL", 0) or 0)
        realized = float(values.get("RealizedPnL", 0) or 0)

        return {
            "equity": equity,
            "cash": cash,
            "unrealizedPnL": unrealized,
            "realizedPnL": realized,
            "raw": values
        }

    async def get_positions(self) -> list:
        await self.ib_client.ensure_connected()
        if hasattr(self.ib_client.ib, "positionsAsync"):
            positions = await self.ib_client.ib.positionsAsync()
        else:
            positions = self.ib_client.ib.positions()
        results = []
        for pos in positions:
            contract = pos.contract
            option_payload = None
            last_price = None
            if isinstance(contract, Option):
                option_payload = {
                    "strike": contract.strike,
                    "expiry": contract.lastTradeDateOrContractMonth,
                    "side": self._map_right(contract.right)
                }
                try:
                    last_price = await self.options_chain.get_option_premium(
                        contract.symbol,
                        contract.lastTradeDateOrContractMonth,
                        contract.strike,
                        contract.right
                    )
                except Exception:
                    last_price = None
            else:
                last_price = self.market_data.get_last_price(contract.symbol)

            results.append({
                "symbol": contract.symbol,
                "qty": pos.position,
                "avgPrice": pos.avgCost,
                "lastPrice": last_price or 0,
                "unrealizedPnL": (last_price - pos.avgCost) * pos.position * 100 if last_price else 0,
                "option": option_payload
            })

        return results

    async def get_orders(self) -> list:
        await self.ib_client.ensure_connected()
        if hasattr(self.ib_client.ib, "trades"):
            trades = list(self.ib_client.ib.trades())
        else:
            trades = self.ib_client.ib.openTrades()
        completed = []
        if hasattr(self.ib_client.ib, "reqCompletedOrdersAsync"):
            try:
                completed = await self.ib_client.ib.reqCompletedOrdersAsync(False)
            except Exception:
                completed = []
        elif hasattr(self.ib_client.ib, "reqCompletedOrders"):
            try:
                completed = self.ib_client.ib.reqCompletedOrders(False)
            except Exception:
                completed = []
        orders = []
        all_trades = list(trades)
        for trade in completed or []:
            if trade in all_trades:
                continue
            all_trades.append(trade)

        for trade in all_trades:
            contract = trade.contract
            option_payload = None
            if isinstance(contract, Option):
                option_payload = {
                    "strike": contract.strike,
                    "expiry": contract.lastTradeDateOrContractMonth,
                    "side": self._map_right(contract.right)
                }
            orders.append({
                "id": trade.order.orderId,
                "playId": None,
                "symbol": contract.symbol,
                "side": trade.order.action,
                "quantity": trade.order.totalQuantity,
                "status": trade.orderStatus.status,
                "filledQty": trade.orderStatus.filled,
                "avgFillPrice": trade.orderStatus.avgFillPrice,
                "option": option_payload
            })
        orders.sort(key=lambda item: item.get("id") or 0, reverse=True)
        return orders

    def _pick_account(self) -> str:
        accounts = self.ib_client.ib.managedAccounts()
        return accounts[0] if accounts else ""

    @staticmethod
    def _map_right(side: str) -> str:
        side = (side or "").upper()
        if side == "C":
            return "CALL"
        if side == "P":
            return "PUT"
        return side
