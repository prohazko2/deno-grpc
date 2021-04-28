import { getClient } from "../client.ts";
import { Greeter } from "./greeter.d.ts";

const port = 15070;
const root = await Deno.readTextFile("./examples/greeter.proto");

const client = getClient<Greeter>({ port, root, serviceName: "Greeter" });

const resp = await client.SayHello({ name: "oleg" });
console.log(resp);
