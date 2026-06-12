const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const allowedRootFiles = new Set([
  "index.html",
  "styles.css",
  "script.js",
  "pigeondex.html",
  "pigeondex.css",
  "pigeondex.js",
  "pigder.html",
  "pigder.css",
  "pigder.js"
]);

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

  const filePath = path.join(PUBLIC_DIR, normalizedPath);
  const safePath = path.resolve(filePath);
  const safePublicDir = path.resolve(PUBLIC_DIR);

  if (!safePath.startsWith(safePublicDir)) {
    return null;
  }

  return safePath;
}

function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const filePath = getStaticFilePath(url.pathname);

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
