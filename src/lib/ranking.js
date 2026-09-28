export function sortForCategory(users, category) {
  const value = valueForCategory(category);
  return [...users].sort((a, b) => value(b) - value(a) || a.login.localeCompare(b.login));
}

export function valueForCategory(category) {
  if (category === "publicContributions") return (user) => user.publicContributions ?? 0;
  if (category === "totalContributions") return (user) => (user.publicContributions ?? 0) + (user.privateContributions ?? 0);
  if (category === "followers") return (user) => user.followers ?? 0;
  throw new Error(`Unknown category: ${category}`);
}
