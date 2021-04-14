const port = 4500;

const listener = Deno.listenTls({
  port,
  certFile: "./cert/cert.pem",
  keyFile: "./cert/key.pem",
  alpnProtocols: ["h2", "http/1.1"],
});

for await (const conn of listener) {
  handleConn(conn);
}

async function handleConn(conn: Deno.Conn) {
  const httpConn = Deno.serveHttp(conn);
  for await (const { request, respondWith } of httpConn) {
    respondWith(new Response(`Responding to ${request.url}`));
  }
}

// > curl -k -vvvvv --http2 https://localhost:4500/xxx
