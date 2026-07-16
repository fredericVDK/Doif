const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.DATA_FILE = path.join(os.tmpdir(), `pigeon-test-${Date.now()}-${Math.random()}.json`);
process.env.ADMIN_TOKEN = "test-admin";
process.env.AIRTABLE_API_KEY = "";
process.env.AIRTABLE_BASE_ID = "";

const handleRequest = require("../server");

function createTestServer() {
  const server = http.createServer(handleRequest);

  return new Promise((resolve) => {
    server.listen(0, () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, options);
  const data = await response.json();
  return { response, data };
}

test("session endpoint creates an anonymous session", async () => {
  const server = await createTestServer();

  try {
    const { response, data } = await requestJson(server.baseUrl, "/api/session");

    assert.equal(response.status, 200);
    assert.match(data.sessionId, /^ses_/);
    assert.equal(typeof data.totalFeeds, "number");
  } finally {
    await server.close();
  }
});

test("feed endpoint stores full submitted round score", async () => {
  const server = await createTestServer();

  try {
    const session = await fetch(`${server.baseUrl}/api/session`);
    const cookie = session.headers.get("set-cookie");
    const { response, data } = await requestJson(server.baseUrl, "/api/feed", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie
      },
      body: JSON.stringify({ nickname: "Backend Bird", amount: 1234 })
    });

    assert.equal(response.status, 200);
    assert.equal(data.nickname, "Backend Bird");
    assert.equal(data.feeds, 1234);
    assert.equal(data.leaderboard[0].feeds, 1234);
  } finally {
    await server.close();
  }
});

test("admin endpoints require a token and can reset leaderboard", async () => {
  const server = await createTestServer();

  try {
    const blocked = await requestJson(server.baseUrl, "/api/admin/leaderboard");
    assert.equal(blocked.response.status, 401);

    await requestJson(server.baseUrl, "/api/feed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: "Reset Me", amount: 5 })
    });

    const reset = await requestJson(server.baseUrl, "/api/admin/reset-leaderboard", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-token": "test-admin"
      },
      body: "{}"
    });

    assert.equal(reset.response.status, 200);
    assert.equal(reset.data.removed >= 1, true);
    assert.deepEqual(reset.data.leaderboard, []);
  } finally {
    await server.close();
  }
});

test("api docs expose documented endpoints", async () => {
  const server = await createTestServer();

  try {
    const { response, data } = await requestJson(server.baseUrl, "/api/docs");
    const paths = data.endpoints.map((endpoint) => endpoint.path);

    assert.equal(response.status, 200);
    assert.equal(data.name, "Pigeon Crumbs API");
    assert.equal(paths.includes("/api/feed"), true);
    assert.equal(paths.includes("/api/drawings"), true);
    assert.equal(paths.includes("/api/admin/events"), true);
  } finally {
    await server.close();
  }
});

test("drawing endpoint stores and lists submissions", async () => {
  const server = await createTestServer();
  const imageDataUrl = "data:image/png;base64,iVBORw0KGgo=";

  try {
    const submitted = await requestJson(server.baseUrl, "/api/drawings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artist: "Sketch Friend",
        title: "Round Pigeon",
        imageDataUrl
      })
    });

    assert.equal(submitted.response.status, 201);
    assert.equal(submitted.data.drawing.artist, "Sketch Friend");
    assert.equal(submitted.data.drawing.status, "approved");

    const listed = await requestJson(server.baseUrl, "/api/drawings");
    assert.equal(listed.response.status, 200);
    assert.equal(listed.data.drawings.length, 1);
    assert.equal(listed.data.drawings[0].title, "Round Pigeon");
  } finally {
    await server.close();
  }
});
