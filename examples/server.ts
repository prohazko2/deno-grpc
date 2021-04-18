import { GrpcService } from "../serve.ts";
import { Greeter } from "./greeter.d.ts";

const port = 15070;
const text = await Deno.readTextFile("./examples/greeter.proto");

const svc = new GrpcService<Greeter>(text, {
  SayHello({ name }) {
    const message = `hello ${name || "stranger"}`;
    return { message, time: new Date().toISOString() };
  },
});

console.log(`gonna listen on ${port} port`);
for await (const conn of Deno.listen({ port })) {
  await svc.handleUnary(conn);
}
