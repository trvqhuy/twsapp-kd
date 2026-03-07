const formatCurrency = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
};

const formatNumber = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }
  return Number(value).toFixed(digits);
};

const formatDelta = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }
  const sign = value > 0 ? "+" : "";
  const formatted = formatCurrency(Math.abs(value));
  if (formatted === "--") {
    return "--";
  }
  return `${sign}${formatted}`;
};

const formatTimestamp = (ts) => {
  if (!ts) {
    return "--";
  }
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

export { formatCurrency, formatNumber, formatDelta, formatTimestamp };
