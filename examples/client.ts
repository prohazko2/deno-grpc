import { hexdump } from "https://deno.land/x/prohazko@1.3.3/hex.ts";
import { getClient } from "../client.ts";
import { Greeter } from "./greeter.d.ts";

const port = 15070;
const text = await Deno.readTextFile("./examples/greeter.proto");

const conn = await Deno.connect({ port });

const client = getClient(text, conn);

client.conn._readToCompletion();

await client.conn.sendPrelude();

await client.conn.sendSettings();

await client.conn.sendHeaders({
  "content-type": "application/grpc",
  "accept-encoding": "identity",
  "grpc-accept-encoding": "identity",
  te: "trailers",
  ":scheme": "http",
  ":method": "POST",
  ":authority": "localhost",
  ":path": "/prohazko.Greeter/SayHello",
});

const res = client.def
  .lookupType("HelloRequest")
  .encode({ name: "oleg" })
  .finish();

const out = new Uint8Array(5 + res.length);
out.set([0x00, 0x00, 0x00, 0x00, res.length]);
out.set(res, 5);

await client.conn.endData(out);

const data = await client.conn._waitForDataFrame();

console.log("headers", client.conn.headers);
console.log("data", hexdump(data));
