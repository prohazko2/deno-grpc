export const logData = false;

import { hexdump } from "https://deno.land/x/prohazko@1.3.5/hex.ts";

function consoleLog(level: string, ...args: any[]) {
  if (!logData) {
    return;
  }
  let [more, msg] = args || [];

  if (more && more.frame) {
    more = `frame ${more.frame.type} of s:${
      more.frame.stream
    } with flags ${JSON.stringify(more.frame.flags)}`;
  }

  if (more && more.data) {
    more = "\n" + hexdump(more.data).trim();
  }

  console.log(`${new Date().toISOString()} ${level[0]} ${msg}`, more);
}

export const consoleLogger = () => ({
  debug: (...args: any[]) => consoleLog("debug", ...args),
  trace: (...args: any[]) => consoleLog("trace", ...args),
  error: (...args: any[]) => consoleLog("error", ...args),
});
