const GRAPHQL_URL = "https://api.github.com/graphql";
const REST_SEARCH_URL = "https://api.github.com/search/users";
const REQUEST_TIMEOUT_MS = 20000;

const USER_FIELDS = `
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
  }`;

export class GitHubClient {
  constructor({ token, fetchImpl = globalThis.fetch }) {
    if (!token) throw new Error("GITHUB_TOKEN is required unless --mock is used");
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async searchUsers({ query, page = 1, perPage = 100 }) {
    const url = new URL(REST_SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    const payload = await this.requestJson(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28"
      }
    });

    return {
      total: payload.body.total_count ?? 0,
      incomplete: Boolean(payload.body.incomplete_results),
      users: (payload.body.items ?? []).map((user) => ({
        login: user.login,
        avatarUrl: user.avatar_url ?? "",
        htmlUrl: user.html_url ?? ""
      })),
      rateLimit: payload.rateLimit
    };
  }

  async enrichUsers({ logins, contributionWindow }) {
    if (!logins.length) {
      return { users: [], rateLimit: null };
    }

    const query = buildUsersQuery(logins);
    const payload = await this.requestJson(GRAPHQL_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        query,
        variables: {
          from: contributionWindow.from,
          to: contributionWindow.to
        }
      })
    });

    if (payload.body.errors?.length) {
      const rateLimit = payload.body.data?.rateLimit;
      const message = payload.body.errors.map((error) => error.message).join("; ");
      throw Object.assign(new Error(message), {
        resourceLimit: message.toLowerCase().includes("resource limits"),
        rateLimit
      });
    }

    return {
      users: Object.entries(payload.body.data)
        .filter(([key, value]) => key.startsWith("u") && value)
        .map(([, user]) => mapUser(user)),
      rateLimit: payload.body.data.rateLimit
    };
  }

  async requestJson(url, options) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        throw Object.assign(new Error(`GitHub API request timed out after ${REQUEST_TIMEOUT_MS}ms`), {
          timeout: true
        });
      }
      if (isNetworkFailure(error)) {
        throw Object.assign(new Error(`GitHub API network request failed: ${error.message}`), {
          network: true
        });
      }
      throw error;
    }

    const rateLimit = {
      limit: numberHeader(response, "x-ratelimit-limit"),
      remaining: numberHeader(response, "x-ratelimit-remaining"),
      reset: numberHeader(response, "x-ratelimit-reset"),
      retryAfter: numberHeader(response, "retry-after")
    };

    if (!response.ok) {
      throw Object.assign(new Error(`GitHub API request failed: ${response.status}`), {
        status: response.status,
        retryAfter: rateLimit.retryAfter,
        reset: rateLimit.reset
      });
    }

    let body;
    try {
      body = await response.json();
    } catch (error) {
      if (isNetworkFailure(error)) {
        throw Object.assign(new Error(`GitHub API response stream failed: ${error.message}`), {
          network: true,
          retryAfter: rateLimit.retryAfter,
          reset: rateLimit.reset
        });
      }
      throw error;
    }

    return {
      body,
      rateLimit
    };
  }
}

export class MockGitHubClient {
  async searchUsers({ query, page = 1 }) {
    const users = page > 1
      ? []
      : [
          { login: "octocat" },
          { login: "nino" },
          { login: "sofia-dev" }
        ].filter((user) => query.toLowerCase().includes(user.login.split("-")[0]) || query.includes("location:"));

    return {
      total: users.length,
      incomplete: false,
      users,
      rateLimit: { remaining: 999, reset: Math.floor(Date.now() / 1000) + 3600 }
    };
  }

  async enrichUsers({ logins }) {
    const users = logins.map((login) => {
      if (login === "nino") return mockUser("nino", "Tbilisi, Georgia", 42, 330);
      if (login === "sofia-dev") return mockUser("sofia-dev", "Sofia, Bulgaria", 7, 41);
      return mockUser(login, "San Francisco, CA", 999, 120);
    });

    return {
      users,
      rateLimit: { remaining: 999, resetAt: new Date(Date.now() + 3600000).toISOString() }
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

function buildUsersQuery(logins) {
  const users = logins.map((login, index) => {
    return `u${index}: user(login: ${JSON.stringify(login)}) {${USER_FIELDS}}`;
  }).join("\n");

  return `
query EnrichUsers($from: DateTime!, $to: DateTime!) {
${users}
  rateLimit {
    cost
    limit
    remaining
    resetAt
  }
}`;
}

function numberHeader(response, name) {
  const value = response.headers.get(name);
  return value === null ? null : Number(value);
}

function isNetworkFailure(error) {
  return error?.cause?.code === "UND_ERR_SOCKET" ||
    error?.code === "UND_ERR_SOCKET" ||
    error?.name === "SocketError" ||
    (error instanceof TypeError && error.message === "terminated");
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
