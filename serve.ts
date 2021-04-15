import { hexdump } from "https://deno.land/x/prohazko@1.3.3/hex.ts";
import { parse } from "./proto.ts";

const port = 15070;

const text = await Deno.readTextFile("./_/test.proto");
console.log(text);

const { root } = parse(text);

const Req = root.lookupType("HelloRequest");
const Res = root.lookupType("HelloReply");

console.log(`gonna listen on ${port} port`);
for await (const conn of Deno.listen({ port })) {
  handleConn(conn);
}

async function handleConn(conn: Deno.Conn) {
  for await (const { request, respondWith } of Deno.serveHttp(conn)) {
    console.log(">", request.url);

    const blob = await request.blob();
    const buf = new Uint8Array(await blob.arrayBuffer(), 5);
    console.log(hexdump(buf));

    const req = (Req.decode(buf) as any) as { name: string };
    console.log(req);

    const res = Res.encode({
      message: `hello to you, ${req.name || "stanger"}`,
    }).finish();

    const resp = new Response(res);

    respondWith(resp);
  }
}
