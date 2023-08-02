import type {
  Root,
  Type,
  Field,
  Service,
  Message,
  Method,
  ReflectionObject,
  IParserResult
} from "npm:protobufjs@7.2.4";

import lib from "npm:protobufjs@7.2.4";

export { Root, Type, Field, Service, Message, Method, ReflectionObject };

export function parse(proto: string): IParserResult {
  return lib.parse(proto);
}
