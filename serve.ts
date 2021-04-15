const port = 15070;

import { hexdump } from "https://deno.land/x/prohazko@1.3.3/hex.ts";

console.log(`gonna listen on ${port} port`);
for await (const conn of Deno.listen({ port })) {
  handleConn(conn);
}

async function handleConn(conn: Deno.Conn) {
  for await (const { request, respondWith } of Deno.serveHttp(conn)) {
    console.log(">", request.url);

    const blob = await request.blob();
    console.log(hexdump(await blob.arrayBuffer()));

    respondWith(new Response(`responding to ${request.url}`));
  }
}
