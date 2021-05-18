import { GrpcServer } from "../server.ts";
import { Greeter } from "./greeter.d.ts";

const port = 15070;
const server = new GrpcServer();

const protoPath = new URL("./greeter.proto", import.meta.url);
const protoFile = await Deno.readTextFile(protoPath);

server.addService<Greeter>(protoFile, {
  // deno-lint-ignore require-await
  async SayHello({ name }) {
    const message = `hello ${name || "stranger"}`;
    return { message, time: new Date().toISOString() };
  },
  async *ShoutHello({ name }) {
    for (const n of [0, 1, 2]) {
      const message = `hello ${name || "stranger"} #${n}`;
      yield { message, time: new Date().toISOString() };
    }
  },
});

console.log(`gonna listen on ${port} port`);
for await (const conn of Deno.listen({ port })) {
  server.handle(conn);
}
