import { getClient } from "../client.ts";
import { Greeter } from "./greeter.d.ts";

const client = getClient<Greeter>({
  port: 15070,
  root: await Deno.readTextFile("./examples/greeter.proto"),
  serviceName: "Greeter",
});

const resp = await client.SayHello({ name: "oleg" });
console.log(resp);

client.close();
