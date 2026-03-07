const evaluateCondition = (condition, lastPrice) => {
  if (!condition) {
    return false;
  }
  if (condition.type === "IF_RISES") {
    return lastPrice >= Number(condition.value);
  }
  if (condition.type === "IF_DROPS") {
    return lastPrice <= Number(condition.value);
  }
  return false;
};

export { evaluateCondition };
