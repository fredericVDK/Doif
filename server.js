const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const publicDirCandidates = [
  __dirname,
  process.cwd(),
  path.join(__dirname, "..")
];
const allowedRootFiles = new Set(["index.html", "styles.css", "script.js"]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function sendFile(response, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[extension] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "content-type": "text/plain; charset=utf-8"
      });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, { "content-type": contentType });
    response.end(content);
  });
}

function getStaticFilePath(pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const decodedPath = decodeURIComponent(requestedPath);
  const trimmedPath = decodedPath.replace(/^\/+/, "");
  const normalizedPath = path.normalize(trimmedPath);

  if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
    return null;
  }

  const firstSegment = normalizedPath.split(path.sep)[0];

  if (!allowedRootFiles.has(normalizedPath) && firstSegment !== "assets") {
    return null;
  }

  for (const publicDir of publicDirCandidates) {
    const filePath = path.join(publicDir, normalizedPath);
    const safePath = path.resolve(filePath);
    const safePublicDir = path.resolve(publicDir);

    if (safePath.startsWith(safePublicDir) && fs.existsSync(safePath)) {
      return safePath;
    }
  }

  return path.join(__dirname, normalizedPath);
}

function getRequestPath(request) {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.searchParams.has("path")) {
    const routePath = url.searchParams.get("path");
    return routePath ? `/${routePath}` : "/";
  }

  return url.pathname;
}

function handleRequest(request, response) {
  const filePath = getStaticFilePath(getRequestPath(request));

  if (!filePath) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  sendFile(response, filePath);
}

if (require.main === module) {
  const server = http.createServer(handleRequest);

  server.listen(PORT, () => {
    console.log(`Pigeon Crumbs is running at http://localhost:${PORT}`);
  });
}

module.exports = handleRequest;
