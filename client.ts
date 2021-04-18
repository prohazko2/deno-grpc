import { hexdump } from "https://deno.land/x/prohazko@1.3.3/hex.ts";
import { parse, Root } from "./proto.ts";

const port = 15070;

export class GrpcClient {
  def: Root;

  constructor(_def: string | Root, public conn: Deno.Conn) {
    this.def = _def as Root;
    if (typeof _def === "string") {
      this.def = parse(_def).root;
    }
  }
}

export function getClient(_def: string | Root, conn: Deno.Conn) {}
