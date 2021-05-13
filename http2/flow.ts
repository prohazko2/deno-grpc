import _assert from "https://deno.land/std@0.93.0/node/assert.ts";

import { Duplex } from "https://deno.land/std@0.93.0/node/stream.ts";

import type { Frame } from "./frames.ts";

const assert = _assert as Function;

// The Flow class
// ==============

// Flow is a [Duplex stream][1] subclass which implements HTTP/2 flow control. It is designed to be
// subclassed by [Connection](connection.html) and the `upstream` component of [Stream](stream.html).
// [1]: https://nodejs.org/api/stream.html#stream_class_stream_duplex

export { Flow };

// Public API
// ----------

// * **Event: 'error' (type)**: signals an error
//
// * **setInitialWindow(size)**: the initial flow control window size can be changed *any time*
//   ([as described in the standard][1]) using this method
//
// [1]: https://tools.ietf.org/html/rfc7540#section-6.9.2

// API for child classes
// ---------------------

// * **new Flow([flowControlId])**: creating a new flow that will listen for WINDOW_UPDATES frames
//   with the given `flowControlId` (or every update frame if not given)
//
// * **_send()**: called when more frames should be pushed. The child class is expected to override
//   this (instead of the `_read` method of the Duplex class).
//
// * **_receive(frame, readyCallback)**: called when there's an incoming frame. The child class is
//   expected to override this (instead of the `_write` method of the Duplex class).
//
// * **push(frame): bool**: schedules `frame` for sending.
//
//   Returns `true` if it needs more frames in the output queue, `false` if the output queue is
//   full, and `null` if did not push the frame into the output queue (instead, it pushed it into
//   the flow control queue).
//
// * **read(limit): frame**: like the regular `read`, but the 'flow control size' (0 for non-DATA
//   frames, length of the payload for DATA frames) of the returned frame will be under `limit`.
//   Small exception: pass -1 as `limit` if the max. flow control size is 0. `read(0)` means the
//   same thing as [in the original API](https://nodejs.org/api/stream.html#stream_stream_read_0).
//
// * **getLastQueuedFrame(): frame**: returns the last frame in output buffers
//
// * **_log**: the Flow class uses the `_log` object of the parent

// Constructor
// -----------

// When a HTTP/2.0 connection is first established, new streams are created with an initial flow
// control window size of 65535 bytes.
const INITIAL_WINDOW_SIZE = 65535;

const logData = false;
const noop = () => {};
const consoleLogger = () => ({
  debug: (...args: any[]) => (logData ? console.log(...args) : noop()),
  trace: (...args: any[]) => (logData ? console.log(...args) : noop()),
  error: (...args: any[]) => (logData ? console.error(...args) : noop()),
});

// `flowControlId` is needed if only specific WINDOW_UPDATEs should be watched.
class Flow extends Duplex {
  _log = consoleLogger();

  _window: number;
  _initialWindow: number;
  _flowControlId?: number;

  _queue: Frame[];
  _ended: boolean;
  _received: number;

  _restoreWindowTimer?: number;

  constructor(flowControlId?: number) {
    super({ objectMode: true });

    this._window = this._initialWindow = INITIAL_WINDOW_SIZE;
    this._flowControlId = flowControlId;
    this._queue = [];
    this._ended = false;
    this._received = 0;
  }

  // Incoming frames
  // ---------------

  // `_receive` is called when there's an incoming frame.
  _receive(frame: Frame, callback: Function) {
    throw new Error(
      "The _receive(frame, callback) method has to be overridden by the child class!"
    );
  }

  // `_receive` is called by `_write` which in turn is [called by Duplex][1] when someone `write()`s
  // to the flow. It emits the 'receiving' event and notifies the window size tracking code if the
  // incoming frame is a WINDOW_UPDATE.
  // [1]: https://nodejs.org/api/stream.html#stream_writable_write_chunk_encoding_callback_1
  _write = (frame: Frame, encoding: string, callback: Function) => {
    const sentToUs =
      this._flowControlId === undefined || frame.stream === this._flowControlId;

    if (sentToUs && (frame.flags.END_STREAM || frame.type === "RST_STREAM")) {
      this._ended = true;
    }

    if (frame.type === "DATA" && frame.data.length > 0) {
      this._receive(frame, () => {
        this._received += frame.data.length;
        if (!this._restoreWindowTimer) {
          this._restoreWindowTimer = setTimeout(this._restoreWindow.bind(this));
        }
        callback();
      });
    } else {
      this._receive(frame, callback);
    }

    if (sentToUs && frame.type === "WINDOW_UPDATE") {
      this._updateWindow(frame);
    }
  };

  // `_restoreWindow` basically acknowledges the DATA frames received since it's last call. It sends
  // a WINDOW_UPDATE that restores the flow control window of the remote end.
  // TODO: push this directly into the output queue. No need to wait for DATA frames in the queue.
  _restoreWindow() {
    delete this._restoreWindowTimer;
    if (!this._ended && this._received > 0) {
      this.push({
        type: "WINDOW_UPDATE",
        flags: {},
        stream: this._flowControlId,
        window_size: this._received,
      } as Frame);
      this._received = 0;
    }
  }

  // Outgoing frames - sending procedure
  // -----------------------------------

  //                                         flow
  //                +-------------------------------------------------+
  //                |                                                 |
  //                +--------+           +---------+                  |
  //        read()  | output |  _read()  | flow    |  _send()         |
  //     <----------|        |<----------| control |<-------------    |
  //                | buffer |           | buffer  |                  |
  //                +--------+           +---------+                  |
  //                | input  |                                        |
  //     ---------->|        |----------------------------------->    |
  //       write()  | buffer |  _write()              _receive()      |
  //                +--------+                                        |
  //                |                                                 |
  //                +-------------------------------------------------+

  // `_send` is called when more frames should be pushed to the output buffer.
  _send() {
    throw new Error(
      "The _send() method has to be overridden by the child class!"
    );
  }

  // `_send` is called by `_read` which is in turn [called by Duplex][1] when it wants to have more
  // items in the output queue.
  // [1]: https://nodejs.org/api/stream.html#stream_writable_write_chunk_encoding_callback_1
  _read = () => {
    // * if the flow control queue is empty, then let the user push more frames
    if (this._queue.length === 0) {
      this._send();
    }

    // * if there are items in the flow control queue, then let's put them into the output queue (to
    //   the extent it is possible with respect to the window size and output queue feedback)
    else if (this._window > 0) {
      this._readableState.sync = true; // to avoid reentrant calls
      do {
        var moreNeeded = this._push(this._queue[0]);
        if (moreNeeded !== null) {
          this._queue.shift();
        }
      } while (moreNeeded && this._queue.length > 0);
      this._readableState.sync = false;

      assert(
        !moreNeeded || // * output queue is full
          this._queue.length === 0 || // * flow control queue is empty
          (!this._window && this._queue[0].type === "DATA")
      ); // * waiting for window update
    }

    // * otherwise, come back when the flow control window is positive
    else {
      this.once("window_update", this._read);
    }
  };

  // `read(limit)` is like the `read` of the Readable class, but it guarantess that the 'flow control
  // size' (0 for non-DATA frames, length of the payload for DATA frames) of the returned frame will
  // be under `limit`.
  read(limit: number) {
    if (limit === 0) {
      return Duplex.prototype.read.call(this, 0);
    } else if (limit === -1) {
      limit = 0;
    } else if (limit === undefined || limit > MAX_PAYLOAD_SIZE) {
      limit = MAX_PAYLOAD_SIZE;
    }

    // * Looking at the first frame in the queue without pulling it out if possible.
    let frame = (this._readableState as any).buffer[0];
    if (!frame && !this._readableState.ended) {
      this._read();
      frame = (this._readableState as any).buffer[0];
    }

    if (frame && frame.type === "DATA") {
      // * If the frame is DATA, then there's two special cases:
      //   * if the limit is 0, we shouldn't return anything
      //   * if the size of the frame is larger than limit, then the frame should be split
      if (limit === 0) {
        return Duplex.prototype.read.call(this, 0);
      } else if (frame.data.length > limit) {
        this._log.trace(
          { frame, size: frame.data.length, forwardable: limit },
          "Splitting out forwardable part of a DATA frame."
        );
        this.unshift({
          type: "DATA",
          flags: {},
          stream: frame.stream,
          data: frame.data.slice(0, limit),
        });
        frame.data = frame.data.slice(limit);
      }
    }

    return Duplex.prototype.read.call(this);
  }

  // `_parentPush` pushes the given `frame` into the output queue
  _parentPush(frame: Frame) {
    this._log.trace({ frame }, "Pushing frame into the output queue");

    if (frame && frame.type === "DATA" && this._window !== Infinity) {
      this._log.trace(
        { window: this._window, by: frame.data.length },
        "Decreasing flow control window size."
      );
      this._window -= frame.data.length;
      assert(this._window >= 0);
    }

    return Duplex.prototype.push.call(this, frame);
  }

  // `_push(frame)` pushes `frame` into the output queue and decreases the flow control window size.
  // It is capable of splitting DATA frames into smaller parts, if the window size is not enough to
  // push the whole frame. The return value is similar to `push` except that it returns `null` if it
  // did not push the whole frame to the output queue (but maybe it did push part of the frame).
  _push(frame: Frame) {
    const data = frame && frame.type === "DATA" && frame.data;
    const maxFrameLength = this._window < 16384 ? this._window : 16384;

    if (!data || data.length <= maxFrameLength) {
      return this._parentPush(frame);
    } else if (this._window <= 0) {
      return null;
    } else {
      this._log.trace(
        { frame, size: frame.data.length, forwardable: this._window },
        "Splitting out forwardable part of a DATA frame."
      );
      frame.data = data.slice(maxFrameLength);
      this._parentPush({
        type: "DATA",
        flags: {},
        stream: frame.stream,
        data: data.slice(0, maxFrameLength),
      } as Frame);
      return null;
    }
  }

  // Push `frame` into the flow control queue, or if it's empty, then directly into the output queue
  push(frame: Frame): boolean {
    if (frame === null) {
      this._log.debug("Enqueueing outgoing End Of Stream");
    } else {
      this._log.debug({ frame }, "Enqueueing outgoing frame");
    }

    let moreNeeded = null;
    if (this._queue.length === 0) {
      moreNeeded = this._push(frame);
    }

    if (moreNeeded === null) {
      this._queue.push(frame);
    }

    return moreNeeded!;
  }

  // `getLastQueuedFrame` returns the last frame in output buffers. This is primarily used by the
  // [Stream](stream.html) class to mark the last frame with END_STREAM flag.
  getLastQueuedFrame() {
    const readableQueue = this._readableState.buffer;
    return (
      this._queue[this._queue.length - 1] ||
      (readableQueue as any)[readableQueue.length - 1]
    );
  }

  _increaseWindow(size: number) {
    if (this._window === Infinity && size !== Infinity) {
      this._log.error(
        "Trying to increase flow control window after flow control was turned off."
      );
      this.emit("error", "FLOW_CONTROL_ERROR");
    } else {
      this._log.trace(
        { window: this._window, by: size },
        "Increasing flow control window size."
      );
      this._window += size;
      if (this._window !== Infinity && this._window > WINDOW_SIZE_LIMIT) {
        this._log.error("Flow control window grew too large.");
        this.emit("error", "FLOW_CONTROL_ERROR");
      } else {
        if (size != 0) {
          this.emit("window_update");
        }
      }
    }
  }

  // The `_updateWindow` method gets called every time there's an incoming WINDOW_UPDATE frame. It
  // modifies the flow control window:
  //
  // * Flow control can be disabled for an individual stream by sending a WINDOW_UPDATE with the
  //   END_FLOW_CONTROL flag set. The payload of a WINDOW_UPDATE frame that has the END_FLOW_CONTROL
  //   flag set is ignored.
  // * A sender that receives a WINDOW_UPDATE frame updates the corresponding window by the amount
  //   specified in the frame.
  _updateWindow({ flags, window_size }: Frame) {
    this._increaseWindow(flags.END_FLOW_CONTROL ? Infinity : window_size);
  }

  // A SETTINGS frame can alter the initial flow control window size for all current streams. When the
  // value of SETTINGS_INITIAL_WINDOW_SIZE changes, a receiver MUST adjust the size of all stream by
  // calling the `setInitialWindow` method. The window size has to be modified by the difference
  // between the new value and the old value.
  setInitialWindow(initialWindow: number) {
    this._increaseWindow(initialWindow - this._initialWindow);
    this._initialWindow = initialWindow;
  }
}

Flow.prototype = Object.create(Duplex.prototype, {
  constructor: { value: Flow },
});

const MAX_PAYLOAD_SIZE = 4096; // Must not be greater than MAX_HTTP_PAYLOAD_SIZE which is 16383

// Outgoing frames - managing the window size
// ------------------------------------------

// Flow control window size is manipulated using the `_increaseWindow` method.
//
// * Invoking it with `Infinite` means turning off flow control. Flow control cannot be enabled
//   again once disabled. Any attempt to re-enable flow control MUST be rejected with a
//   FLOW_CONTROL_ERROR error code.
// * A sender MUST NOT allow a flow control window to exceed 2^31 - 1 bytes. The action taken
//   depends on it being a stream or the connection itself.

const WINDOW_SIZE_LIMIT = 2 ** 31 - 1;
