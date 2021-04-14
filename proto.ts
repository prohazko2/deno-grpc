/*
> cat rollup.config.js

import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";

export default {
  input: "src/index-minimal.js",
  output: {
    file: "protobuf.js",
    format: "esm",
  },
  plugins: [nodeResolve(), commonjs()],
};

 */

import type {
  //parse,
  Root,
  //IParseOptions,
} from "https://raw.githubusercontent.com/protobufjs/protobuf.js/v6.10.2/index.d.ts";

import protobuf from "./vendor/protobuf@v6.10.2.js";

const xs = protobuf.exports as any;

console.log(xs);
console.log(xs.parse);
