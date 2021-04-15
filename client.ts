import { hexdump } from "https://deno.land/x/prohazko@1.3.3/hex.ts";
import { parse } from "./proto.ts";

const port = 15070;

const text = await Deno.readTextFile("./_/test.proto");

const { root } = parse(text);

const Req = root.lookupType("HelloRequest");
const Res = root.lookupType("HelloReply");

const req = Req.encode({ name: `xxx` }).finish();

const body = new Uint8Array(5 + req.length);
body.set([0x00, 0x00, 0x00, 0x00, req.length]);
body.set(req, 5);

const client = Deno.createHttpClient({});
const res = await fetch(`http://localhost:${port}/ric.echo.Echo/SayHello`, {
  method: "POST",
  body,
 // client,
});

console.log(res);
