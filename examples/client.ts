import { getClient } from "../client.ts";
import { Greeter } from "./greeter.d.ts";

const client = getClient<Greeter>({
  port: 15070,
  root: await Deno.readTextFile("./examples/greeter.proto"),
  serviceName: "Greeter",
});

console.log(await client.SayHello({ name: "oleg 01" }));
console.log(await client.SayHello({ name: "oleg 02" }));

client.close();
