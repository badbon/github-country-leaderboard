import { canSplitDateRange, midpointDate, nextDate } from "./dates.js";

export function splitTask(task) {
  if (canSplitDateRange(task.createdStart, task.createdEnd)) {
    const mid = midpointDate(task.createdStart, task.createdEnd);
    const afterMid = nextDate(mid);
    return [
      { ...task, createdEnd: mid },
      { ...task, createdStart: afterMid }
    ].filter((part) => part.createdStart <= part.createdEnd);
  }

  return splitFollowers(task);
}

function splitFollowers(task) {
  const min = task.followersMin ?? 1;
  const max = task.followersMax;

  if (max === undefined || max === null) {
    return [
      { ...task, followersMin: min, followersMax: 1000 },
      { ...task, followersMin: 1001, followersMax: null }
    ];
  }

  if (min >= max) {
    throw new Error(`Search shard still exceeds cap and cannot be split: ${JSON.stringify(task)}`);
  }

  const mid = Math.floor((min + max) / 2);
  return [
    { ...task, followersMin: min, followersMax: mid },
    { ...task, followersMin: mid + 1, followersMax: max }
  ];
}
