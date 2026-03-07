const parseTimeToMinutes = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
};

const formatTime = (value) => {
  if (!value) {
    return "--";
  }
  return value;
};

export { parseTimeToMinutes, formatTime };
