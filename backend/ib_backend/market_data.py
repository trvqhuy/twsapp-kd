from ib_async import Stock


class MarketDataService:
    def __init__(self, ib_client, events) -> None:
        self.ib_client = ib_client
        self.events = events
        self.tickers = {}
        self.prices = {}

    async def subscribe(self, symbols: list) -> None:
        await self.ib_client.ensure_connected()
        for symbol in symbols:
            symbol = symbol.upper()
            if symbol in self.tickers:
                continue
            contract = Stock(symbol, "SMART", "USD")
            await self._qualify(contract)
            ticker = self.ib_client.ib.reqMktData(contract, "", False, False)
            ticker.updateEvent += lambda t, sym=symbol: self._on_ticker(sym, t)
            self.tickers[symbol] = ticker

    async def unsubscribe(self, symbols: list) -> None:
        await self.ib_client.ensure_connected()
        for symbol in symbols:
            symbol = symbol.upper()
            ticker = self.tickers.pop(symbol, None)
            if ticker:
                self.ib_client.ib.cancelMktData(ticker.contract)
                self.prices.pop(symbol, None)

    def get_last_price(self, symbol: str):
        return self.prices.get(symbol.upper())

    def _on_ticker(self, symbol: str, ticker) -> None:
        price = None
        if ticker.last:
            price = ticker.last
        elif ticker.bid and ticker.ask:
            price = (ticker.bid + ticker.ask) / 2
        elif ticker.close:
            price = ticker.close
        if price is None:
            return
        price = float(price)
        self.prices[symbol] = price
        ts = None
        if getattr(ticker, "time", None):
            try:
                ts = ticker.time.isoformat()
            except Exception:
                ts = None
        self.events.emit_sync("price_update", {"symbol": symbol, "price": price, "ts": ts})

    async def _qualify(self, contract):
        if hasattr(self.ib_client.ib, "qualifyContractsAsync"):
            await self.ib_client.ib.qualifyContractsAsync(contract)
        else:
            self.ib_client.ib.qualifyContracts(contract)
