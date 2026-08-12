const GRAPHQL_URL = "https://api.github.com/graphql";

const SEARCH_QUERY = `
query SearchUsers($query: String!, $first: Int!, $after: String, $from: DateTime!, $to: DateTime!) {
  search(type: USER, query: $query, first: $first, after: $after) {
    userCount
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      __typename
      ... on User {
        login
        name
        avatarUrl(size: 72)
        location
        company
        twitterUsername
        createdAt
        followers {
          totalCount
        }
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
          }
          restrictedContributionsCount
        }
      }
    }
  }
  rateLimit {
    cost
    limit
    remaining
    resetAt
  }
}`;

export class GitHubClient {
  constructor({ token, fetchImpl = globalThis.fetch, now = () => new Date() }) {
    if (!token) throw new Error("GITHUB_TOKEN is required unless --mock is used");
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  async searchUsers({ query, first = 100, after = null, contributionWindow }) {
    const response = await this.fetchImpl(GRAPHQL_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables: {
          query,
          first,
          after,
          from: contributionWindow.from,
          to: contributionWindow.to
        }
      })
    });

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const reset = response.headers.get("x-ratelimit-reset");
      throw Object.assign(new Error(`GitHub API request failed: ${response.status}`), {
        status: response.status,
        retryAfter,
        reset
      });
    }

    const payload = await response.json();
    if (payload.errors?.length) {
      const rateLimit = payload.data?.rateLimit;
      throw Object.assign(new Error(payload.errors.map((error) => error.message).join("; ")), {
        rateLimit
      });
    }

    return {
      total: payload.data.search.userCount,
      users: payload.data.search.nodes.filter((node) => node?.__typename === "User").map(mapUser),
      pageInfo: payload.data.search.pageInfo,
      rateLimit: payload.data.rateLimit
    };
  }
}

export class MockGitHubClient {
  async searchUsers({ query, after = null }) {
    const users = after
      ? []
      : [
          mockUser("octocat", "San Francisco, CA", 999, 120),
          mockUser("nino", "Tbilisi, Georgia", 42, 330),
          mockUser("sofia-dev", "Sofia, Bulgaria", 7, 41)
        ].filter((user) => query.toLowerCase().includes(user.location.split(",")[0].toLowerCase().split(" ")[0]));

    return {
      total: users.length,
      users,
      pageInfo: { hasNextPage: false, endCursor: null },
      rateLimit: { cost: 1, limit: 1000, remaining: 999, resetAt: new Date(Date.now() + 3600000).toISOString() }
    };
  }
}

export function mapUser(user) {
  const totalContributions = user.contributionsCollection?.contributionCalendar?.totalContributions ?? 0;
  const restricted = user.contributionsCollection?.restrictedContributionsCount ?? 0;
  return {
    login: user.login,
    name: user.name ?? "",
    avatarUrl: user.avatarUrl ?? "",
    location: user.location ?? "",
    company: user.company ?? "",
    twitterUsername: user.twitterUsername ?? "",
    followers: user.followers?.totalCount ?? 0,
    privateContributions: restricted,
    publicContributions: Math.max(0, totalContributions - restricted),
    createdAt: user.createdAt
  };
}

function mockUser(login, location, followers, publicContributions) {
  return {
    login,
    name: login,
    avatarUrl: `https://github.com/${login}.png`,
    location,
    company: "",
    twitterUsername: "",
    followers,
    privateContributions: 0,
    publicContributions,
    createdAt: "2020-01-01T00:00:00Z"
  };
}
