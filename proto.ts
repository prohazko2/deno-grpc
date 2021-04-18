import type { Root } from "https://raw.githubusercontent.com/protobufjs/protobuf.js/v6.10.2/index.d.ts";

import protobuf from "./vendor/protobuf@v6.10.2.js";

const lib = protobuf.exports as any;

export { Root };

export function parse(proto: string): { package: string; root: Root } {
  return lib.parse(proto);
}
