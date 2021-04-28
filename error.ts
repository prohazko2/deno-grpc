export enum Status {
  OK = 0,
  CANCELLED,
  UNKNOWN,
  INVALID_ARGUMENT,
  DEADLINE_EXCEEDED,
  NOT_FOUND,
  ALREADY_EXISTS,
  PERMISSION_DENIED,
  RESOURCE_EXHAUSTED,
  FAILED_PRECONDITION,
  ABORTED,
  OUT_OF_RANGE,
  UNIMPLEMENTED,
  INTERNAL,
  UNAVAILABLE,
  DATA_LOSS,
  UNAUTHENTICATED,
}

export function error(code: Status, message = "") {
  const status = Status[code];
  const err = new GrpcError(`${status}: ${message}`);
  err.grpcCode = +code;
  err.grpcMessage = message;
  return err;
}

export class GrpcError extends Error {
  grpcCode = 0;
  grpcMessage = "";
  grpcMetadata: Record<string, string> = {};

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    if (typeof Error["captureStackTrace"] === "function") {
      Error["captureStackTrace"](this, this.constructor);
    } else {
      this.stack = new Error(message).stack;
    }
  }
}
