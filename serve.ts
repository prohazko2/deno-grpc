import { hexdump } from "https://deno.land/x/prohazko@1.3.3/hex.ts";
import { parse } from "./proto.ts";

const port = 15070;

const text = await Deno.readTextFile("./_/test.proto");
console.log(text);

const { root } = parse(text);

const Req = root.lookupType("HelloRequest");
const Res = root.lookupType("HelloReply");

import { Http2Request } from "./http2.ts";

console.log(`gonna listen on ${port} port`);
for await (const conn of Deno.listen({ port })) {
  handleConn(conn);
}

async function handleConn(conn: Deno.Conn) {
  const _req = new Http2Request(conn);
  _req._readToCompletion();

  // const h0 = await _req._waitForHeadersFrame();
  // console.log(hexdump(h0));

  const data = await _req._waitForDataFrame();
  console.log(hexdump(data));

  const req = (Req.decode(data.slice(5)) as any) as { name: string };
  console.log(req);

  const res = Res.encode({
    message: `hello ${req.name || "stanger"}`,
  }).finish();

  const out = new Uint8Array(5 + res.length);
  out.set([0x00, 0x00, 0x00, 0x00, res.length]);
  out.set(res, 5);
  console.log(hexdump(out));

  const stream = 1;

  //this.sentEndStream = true;

  await _req.sendHeaders({
    ":status": "200",
    "grpc-accept-encoding": "identity",
    "grpc-encoding": "identity",
    "content-type": "application/grpc+proto",
  });

  await _req.sendData(out);

  await _req.sendTrailers({
    "grpc-status": "0",
    "grpc-message": "OK",
  });
}
