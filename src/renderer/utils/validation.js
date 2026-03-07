import { parseTimeToMinutes } from "./time.js";

const isPositiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
};

const validateConfig = (config) => {
  const errors = [];
  if (!config) {
    return ["Config is required."];
  }
  if (!Array.isArray(config.versionTargets) || config.versionTargets.length === 0) {
    errors.push("Bot versions must be configured.");
  }
  return errors;
};

const validateCondition = (condition, stepIndex, branchIndex) => {
  const errors = [];
  if (!condition) {
    return [`Step ${stepIndex + 1}, branch ${branchIndex + 1} requires a condition.`];
  }
  if (condition.type !== "IF_RISES" && condition.type !== "IF_DROPS") {
    errors.push(`Step ${stepIndex + 1}, branch ${branchIndex + 1} condition must be a price rise/drop.`);
  }
  if (!isPositiveNumber(condition.value)) {
    errors.push(`Step ${stepIndex + 1}, branch ${branchIndex + 1} condition requires a positive price.`);
  }
  return errors;
};

const validateSteps = (steps) => {
  const errors = [];
  if (!Array.isArray(steps) || steps.length === 0) {
    return ["At least one step is required."];
  }
  steps.forEach((step, index) => {
    if (!Array.isArray(step.branches) || step.branches.length === 0) {
      errors.push(`Step ${index + 1} must include at least one branch.`);
      return;
    }
    step.branches.forEach((branch, branchIndex) => {
      if (!branch.action || !["ACTION_BUY", "ACTION_SELL"].includes(branch.action.type)) {
        errors.push(`Step ${index + 1}, branch ${branchIndex + 1} must include a Buy or Sell action.`);
      }
      if (branch.action && branch.action.quantity !== null && branch.action.quantity !== undefined) {
        if (!isPositiveNumber(branch.action.quantity)) {
          errors.push(`Step ${index + 1}, branch ${branchIndex + 1} quantity must be greater than 0.`);
        }
      }
      errors.push(...validateCondition(branch.condition, index, branchIndex));
    });
  });
  return errors;
};

const validateSchedule = (schedule) => {
  const errors = [];
  if (!schedule) {
    return ["Schedule is required."];
  }
  if (!Array.isArray(schedule.days) || schedule.days.length === 0) {
    errors.push("Select at least one active day.");
  }
  const start = parseTimeToMinutes(schedule.startTime);
  const end = parseTimeToMinutes(schedule.endTime);
  if (start === null || end === null) {
    errors.push("Schedule times must be valid (HH:MM).");
  } else if (start >= end) {
    errors.push("Schedule start time must be before end time.");
  }
  return errors;
};

const validatePlay = (play, config) => {
  const errors = [];
  if (!play.name || play.name.trim().length === 0) {
    errors.push("Play name is required.");
  }
  if (!play.symbol || play.symbol.trim().length === 0) {
    errors.push("Play symbol is required.");
  }
  if (!play.versionTarget) {
    errors.push("Bot version must be selected.");
  } else {
    const versionExists = config.versionTargets.some((version) => version.id === play.versionTarget);
    if (!versionExists) {
      errors.push("Bot version selection is invalid.");
    }
  }
  if (!Number.isFinite(Number(play.quantity)) || Number(play.quantity) <= 0) {
    errors.push("Quantity must be greater than 0.");
  }
  errors.push(...validateSchedule(play.schedule));
  errors.push(...validateSteps(play.steps));
  return errors;
};

export { validateConfig, validatePlay };
