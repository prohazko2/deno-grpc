import { getClient } from "../client.ts";
import { Greeter } from "./greeter.d.ts";

const proto = await Deno.readTextFile("./examples/greeter.proto");

const port = 15070;

const conn = await Deno.connect({ port });
const client = getClient<Greeter>(conn, proto, "Greeter");

const resp = await client.SayHello({ name: "oleg" });

console.log("resp", resp);

conn.close();
