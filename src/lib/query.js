export const FIRST_GITHUB_USER_DATE = "2008-01-01";
export const SEARCH_RESULT_CAP = 1000;

export function buildSearchQuery(task) {
  const parts = [
    "type:user",
    "followers:>=1",
    `created:${task.createdStart}..${task.createdEnd}`,
    `location:${quoteTerm(task.term)}`
  ];

  if (task.followersMin !== undefined || task.followersMax !== undefined) {
    parts.splice(1, 1, followerQualifier(task.followersMin, task.followersMax));
  }

  return parts.join(" ");
}

export function taskKey(task) {
  return [
    task.country,
    task.kind,
    task.term,
    task.createdStart,
    task.createdEnd,
    task.followersMin ?? "",
    task.followersMax ?? ""
  ].join("|");
}

function followerQualifier(min = 1, max = null) {
  if (max === null || max === undefined) return `followers:>=${min}`;
  if (min === max) return `followers:${min}`;
  return `followers:${min}..${max}`;
}

function quoteTerm(term) {
  return JSON.stringify(String(term).trim());
}
