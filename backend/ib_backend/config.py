import json
from dataclasses import dataclass, asdict
from pathlib import Path


@dataclass
class BackendConfig:
    host: str = "127.0.0.1"
    port: int = 8765


@dataclass
class IBConfig:
    host: str = "127.0.0.1"
    port: int = 7497
    clientId: int = 1
    accountId: str = ""
    dataType: str = "delayed"
    tradingMode: str = "paper"
    autoConnect: bool = True
    autoReconnect: bool = True
    reconnectDelaySec: int = 5


@dataclass
class AppConfig:
    backend: BackendConfig
    ib: IBConfig
    symbolWhitelist: list
    strategies: list


def default_config() -> AppConfig:
    return AppConfig(
        backend=BackendConfig(),
        ib=IBConfig(),
        symbolWhitelist=["SPY", "QQQ"],
        strategies=[]
    )


def load_config(path: str) -> AppConfig:
    config_path = Path(path)
    if not config_path.exists():
        config = default_config()
        save_config(path, config)
        return config

    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        config = default_config()
        save_config(path, config)
        return config
    backend = raw.get("backend", {})
    ib = raw.get("ib", {})
    return AppConfig(
        backend=BackendConfig(
            host=backend.get("host", "127.0.0.1"),
            port=int(backend.get("port", 8765))
        ),
        ib=IBConfig(
            host=ib.get("host", "127.0.0.1"),
            port=int(ib.get("port", 7497)),
            clientId=int(ib.get("clientId", 1)),
            accountId=str(ib.get("accountId", "")),
            dataType=str(ib.get("dataType", "delayed")),
            tradingMode=str(ib.get("tradingMode", "paper")),
            autoConnect=bool(ib.get("autoConnect", True)),
            autoReconnect=bool(ib.get("autoReconnect", True)),
            reconnectDelaySec=int(ib.get("reconnectDelaySec", 5))
        ),
        symbolWhitelist=list(raw.get("symbolWhitelist", ["SPY", "QQQ"])),
        strategies=list(raw.get("strategies", []))
    )


def save_config(path: str, config: AppConfig) -> None:
    config_path = Path(path)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    payload = asdict(config)
    config_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def validate_config(config: AppConfig) -> list:
    errors = []
    if not config.ib.host:
        errors.append("IB host is required.")
    if not isinstance(config.ib.port, int) or config.ib.port <= 0:
        errors.append("IB port must be a positive integer.")
    if not isinstance(config.ib.clientId, int) or config.ib.clientId < 0:
        errors.append("IB clientId must be 0 or greater.")
    if config.ib.dataType not in {"live", "frozen", "delayed", "delayed_frozen"}:
        errors.append("Data type must be live, frozen, delayed, or delayed_frozen.")
    if config.ib.tradingMode not in {"paper", "live"}:
        errors.append("Trading mode must be paper or live.")
    if not isinstance(config.ib.reconnectDelaySec, int) or config.ib.reconnectDelaySec < 1:
        errors.append("Reconnect delay must be at least 1 second.")
    if not isinstance(config.backend.port, int) or config.backend.port <= 0:
        errors.append("Backend port must be a positive integer.")
    return errors


def config_to_dict(config: AppConfig) -> dict:
    return asdict(config)


def update_config(existing: AppConfig, updates: dict) -> AppConfig:
    backend_updates = updates.get("backend", {})
    ib_updates = updates.get("ib", {})

    backend = BackendConfig(
        host=str(backend_updates.get("host", existing.backend.host)),
        port=int(backend_updates.get("port", existing.backend.port))
    )

    ib = IBConfig(
        host=str(ib_updates.get("host", existing.ib.host)),
        port=int(ib_updates.get("port", existing.ib.port)),
        clientId=int(ib_updates.get("clientId", existing.ib.clientId)),
        accountId=str(ib_updates.get("accountId", existing.ib.accountId)),
        dataType=str(ib_updates.get("dataType", existing.ib.dataType)),
        tradingMode=str(ib_updates.get("tradingMode", existing.ib.tradingMode)),
        autoConnect=bool(ib_updates.get("autoConnect", existing.ib.autoConnect)),
        autoReconnect=bool(ib_updates.get("autoReconnect", existing.ib.autoReconnect)),
        reconnectDelaySec=int(ib_updates.get("reconnectDelaySec", existing.ib.reconnectDelaySec))
    )

    symbols = updates.get("symbolWhitelist", existing.symbolWhitelist)
    if not isinstance(symbols, list):
        symbols = existing.symbolWhitelist

    strategies = updates.get("strategies", existing.strategies)
    if not isinstance(strategies, list):
        strategies = existing.strategies

    return AppConfig(backend=backend, ib=ib, symbolWhitelist=symbols, strategies=strategies)
