import { hexdump } from "https://deno.land/x/prohazko@1.3.3/hex.ts";
import { getClient } from "../client.ts";
import { Greeter, HelloRequest, HelloReply } from "./greeter.d.ts";

const port = 15070;
const proto = await Deno.readTextFile("./examples/greeter.proto");

const conn = await Deno.connect({ port });

console.log(conn.remoteAddr);

const client = getClient<Greeter>(conn, proto, "Greeter");

const resp = await client._callMethod<HelloRequest, HelloReply>("SayHello", {
  name: "oleg",
});

console.log("resp", resp);

client.close();
