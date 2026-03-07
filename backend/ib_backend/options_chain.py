from datetime import datetime

from ib_async import Option, Stock


class OptionsChainService:
    def __init__(self, ib_client, market_data, events) -> None:
        self.ib_client = ib_client
        self.market_data = market_data
        self.events = events

    async def select_by_premium(self, symbol: str, side: str, target_premium: float, min_days_out: int) -> dict:
        await self.ib_client.ensure_connected()
        symbol = symbol.upper()
        side = side.upper()
        right = self._map_right(side)

        underlying = await self._get_underlying_price(symbol)
        if underlying is None:
            raise RuntimeError("Missing underlying price")

        stock = Stock(symbol, "SMART", "USD")
        await self._qualify(stock)
        params = await self.ib_client.ib.reqSecDefOptParamsAsync(symbol, "", stock.secType, stock.conId)
        if not params:
            raise RuntimeError("No option params returned")

        expirations = sorted(params[0].expirations)
        strikes = sorted(params[0].strikes)
        if not expirations or not strikes:
            raise RuntimeError("No expirations or strikes available")

        now = datetime.utcnow()
        for expiry in expirations:
            expiry_date = self._parse_expiry(expiry)
            if not expiry_date:
                continue
            dte = (expiry_date - now).days
            if dte < min_days_out:
                continue
            selection = await self._find_best_strike(symbol, right, expiry, strikes, underlying, target_premium)
            if selection:
                return selection

        raise RuntimeError("No option meets premium target")

    async def get_option_premium(self, symbol: str, expiry: str, strike: float, side: str) -> float:
        await self.ib_client.ensure_connected()
        contract = Option(symbol.upper(), self._normalize_expiry(expiry), float(strike), self._map_right(side), "SMART", "USD")
        await self._qualify(contract)
        tickers = await self.ib_client.ib.reqTickersAsync(contract)
        ticker = tickers[0] if tickers else None
        premium = self._ticker_price(ticker)
        if premium is None:
            raise RuntimeError("Missing option premium")
        return float(premium)

    async def _get_underlying_price(self, symbol: str):
        price = self.market_data.get_last_price(symbol)
        if price is not None:
            return price
        contract = Stock(symbol, "SMART", "USD")
        await self._qualify(contract)
        tickers = await self.ib_client.ib.reqTickersAsync(contract)
        ticker = tickers[0] if tickers else None
        return self._ticker_price(ticker)

    async def _find_best_strike(self, symbol, right, expiry, strikes, underlying, target_premium):
        center = min(range(len(strikes)), key=lambda idx: abs(strikes[idx] - underlying))
        window = 8
        max_window = max(12, len(strikes) // 2)

        while window <= max_window:
            start = max(0, center - window)
            end = min(len(strikes), center + window + 1)
            batch = strikes[start:end]
            contracts = [Option(symbol, self._normalize_expiry(expiry), float(strike), right, "SMART", "USD") for strike in batch]
            await self._qualify(*contracts)
            tickers = await self.ib_client.ib.reqTickersAsync(*contracts)

            best = None
            for strike, ticker in zip(batch, tickers):
                premium = self._ticker_price(ticker)
                if premium is None:
                    continue
                if premium >= target_premium:
                    if best is None or premium < best["premium"]:
                        best = {"strike": float(strike), "premium": float(premium)}
            if best:
                return {
                    "symbol": symbol,
                    "expiry": expiry,
                    "strike": best["strike"],
                    "premium": best["premium"]
                }
            window += 6
        return None

    @staticmethod
    def _parse_expiry(expiry: str):
        try:
            if "-" in expiry:
                return datetime.strptime(expiry, "%Y-%m-%d")
            if len(expiry) == 8:
                return datetime.strptime(expiry, "%Y%m%d")
        except Exception:
            return None
        return None

    @staticmethod
    def _ticker_price(ticker):
        if not ticker:
            return None
        if ticker.last:
            return ticker.last
        if ticker.bid and ticker.ask:
            return (ticker.bid + ticker.ask) / 2
        if ticker.close:
            return ticker.close
        return None

    async def _qualify(self, *contracts):
        if hasattr(self.ib_client.ib, "qualifyContractsAsync"):
            await self.ib_client.ib.qualifyContractsAsync(*contracts)
        else:
            self.ib_client.ib.qualifyContracts(*contracts)

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
