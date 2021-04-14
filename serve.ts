const port = 4500;

console.log(`server gonna serve on port ${port}`);

for await (const conn of Deno.listen({ port })) {
  for await (const { request, respondWith } of Deno.serveHttp(conn)) {
    respondWith(new Response(`Responding to ${request.url}`));
  }
}
