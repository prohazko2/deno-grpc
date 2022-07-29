import { prompt } from "https://deno.land/x/prohazko@1.3.5/stdio.ts";

import { getClient } from "../client.ts";
import { Greeter } from "./greeter.d.ts";

const protoPath = new URL("./greeter.proto", import.meta.url);
const protoFile = await Deno.readTextFile(protoPath);

export const client = getClient<Greeter>({
  port: 15070,
  root: protoFile,
  serviceName: "Greeter",
});

for (;;) {
  const name = await prompt("name: ");
  if (name === null) {
    break;
  }

  console.log(await client.SayHello({ name }));
}

console.log("Got Ctrl+D,  closing...");
client.close();
