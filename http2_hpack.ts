// TODO: remove node dependencies

// https://github.com/molnarg/node-http2/blob/master/lib/protocol/framer.js

// The framer consists of two [Transform Stream][1] subclasses that operate in [object mode][2]:
// the Serializer and the Deserializer
// [1]: https://nodejs.org/api/stream.html#stream_class_stream_transform
// [2]: https://nodejs.org/api/stream.html#stream_new_stream_readable_options

import _assert from "https://deno.land/std@0.93.0/node/assert.ts";

import { Transform } from "https://deno.land/std@0.93.0/node/stream.ts";
import { Buffer } from "https://deno.land/std@0.93.0/node/buffer.ts";

import type { Frame } from "./http2_frames.ts";

const assert = _assert as Function;

// The implementation of the [HTTP/2 Header Compression][http2-compression] spec is separated from
// the 'integration' part which handles HEADERS and PUSH_PROMISE frames. The compression itself is
// implemented in the first part of the file, and consists of three classes: `HeaderTable`,
// `HeaderSetDecompressor` and `HeaderSetCompressor`. The two latter classes are
// [Transform Stream][node-transform] subclasses that operate in [object mode][node-objectmode].
// These transform chunks of binary data into `[name, value]` pairs and vice versa, and store their
// state in `HeaderTable` instances.
//
// The 'integration' part is also implemented by two [Transform Stream][node-transform] subclasses
// that operate in [object mode][node-objectmode]: the `Compressor` and the `Decompressor`. These
// provide a layer between the [framer](framer.html) and the
// [connection handling component](connection.html).
//
// [node-transform]: https://nodejs.org/api/stream.html#stream_class_stream_transform
// [node-objectmode]: https://nodejs.org/api/stream.html#stream_new_stream_readable_options
// [http2-compression]: https://tools.ietf.org/html/rfc7541

// export { HeaderTable };

// export { HuffmanTable };
// export { HeaderSetCompressor };
// export { HeaderSetDecompressor };
// export { Compressor };
// export { Decompressor };
// import { Transform as TransformStream } from "stream";
// import assert from "assert";
// import util from "util";

const logData = true;

const noop = () => {};

const consoleLogger = () => ({
  trace: (...args: any[]) => (logData ? console.log(...args) : noop()),
  error: (...args: any[]) => (logData ? console.error(...args) : noop()),
});

export type HeaderTablePair = [k: string, v: string];
export type HeaderTableEntry = HeaderTablePair & { _size: number };

// Header compression
// ==================

// The HeaderTable class
// ---------------------

// The [Header Table] is a component used to associate headers to index values. It is basically an
// ordered list of `[name, value]` pairs, so it's implemented as a subclass of `Array`.
// In this implementation, the Header Table and the [Static Table] are handled as a single table.
// [Header Table]: https://tools.ietf.org/html/rfc7541#section-2.3.2
// [Static Table]: https://tools.ietf.org/html/rfc7541#section-2.3.1
export class HeaderTable extends Array {
  _log = consoleLogger();
  _limit = 0;
  _staticLength = 0;
  _size = 0;

  constructor(limit?: number) {
    const rows = staticTable.map(entryFromPair);
    super(...(rows as any));

    this._limit = limit || DEFAULT_HEADER_TABLE_LIMIT;
    this._staticLength = this.length;
    this._size = 0;
    // self._enforceLimit = HeaderTable.prototype._enforceLimit;
    // self.add = HeaderTable.prototype.add;
    // self.setSizeLimit = HeaderTable.prototype.setSizeLimit;
    //return self;
  }

  // The `add(index, entry)` can be used to [manage the header table][tablemgmt]:
  // [tablemgmt]: https://tools.ietf.org/html/rfc7541#section-4
  //
  // * it pushes the new `entry` at the beggining of the table
  // * before doing such a modification, it has to be ensured that the header table size will stay
  //   lower than or equal to the header table size limit. To achieve this, entries are evicted from
  //   the end of the header table until the size of the header table is less than or equal to
  //   `(this._limit - entry.size)`, or until the table is empty.
  //
  //              <----------  Index Address Space ---------->
  //              <-- Static  Table -->  <-- Header  Table -->
  //              +---+-----------+---+  +---+-----------+---+
  //              | 0 |    ...    | k |  |k+1|    ...    | n |
  //              +---+-----------+---+  +---+-----------+---+
  //                                     ^                   |
  //                                     |                   V
  //                              Insertion Point       Drop Point

  _enforceLimit(limit: number) {
    const droppedEntries = [];
    while (this._size > 0 && this._size > limit) {
      const dropped = this.pop();
      this._size -= dropped._size;
      droppedEntries.unshift(dropped);
    }
    return droppedEntries;
  }

  add(entry: HeaderTableEntry) {
    const limit = this._limit - entry._size;
    const droppedEntries = this._enforceLimit(limit);

    if (this._size <= limit) {
      this.splice(this._staticLength, 0, entry);
      this._size += entry._size;
    }

    return droppedEntries;
  }

  // The table size limit can be changed externally. In this case, the same eviction algorithm is used
  setSizeLimit(limit: number) {
    this._limit = limit;
    this._enforceLimit(this._limit);
  }
}

function entryFromPair(pair: HeaderTablePair) {
  const entry = pair.slice() as HeaderTableEntry;
  entry._size = size(entry);
  return entry;
}

// The encoder decides how to update the header table and as such can control how much memory is
// used by the header table.  To limit the memory requirements on the decoder side, the header table
// size is bounded.
//
// * The default header table size limit is 4096 bytes.
// * The size of an entry is defined as follows: the size of an entry is the sum of its name's
//   length in bytes, of its value's length in bytes and of 32 bytes.
// * The size of a header table is the sum of the size of its entries.
var DEFAULT_HEADER_TABLE_LIMIT = 4096;

function size(entry: HeaderTablePair) {
  return Buffer.from(entry[0] + entry[1], "utf8").length + 32;
}

// [The Static Table](https://tools.ietf.org/html/rfc7541#section-2.3.1)
// ------------------

// The table is generated with feeding the table from the spec to the following sed command:
//
//     sed -re "s/\s*\| [0-9]+\s*\| ([^ ]*)/  [ '\1'/g" -e "s/\|\s([^ ]*)/, '\1'/g" -e 's/ \|/],/g'

export const staticTable: HeaderTablePair[] = [
  [":authority", ""],
  [":method", "GET"],
  [":method", "POST"],
  [":path", "/"],
  [":path", "/index.html"],
  [":scheme", "http"],
  [":scheme", "https"],
  [":status", "200"],
  [":status", "204"],
  [":status", "206"],
  [":status", "304"],
  [":status", "400"],
  [":status", "404"],
  [":status", "500"],
  ["accept-charset", ""],
  ["accept-encoding", "gzip, deflate"],
  ["accept-language", ""],
  ["accept-ranges", ""],
  ["accept", ""],
  ["access-control-allow-origin", ""],
  ["age", ""],
  ["allow", ""],
  ["authorization", ""],
  ["cache-control", ""],
  ["content-disposition", ""],
  ["content-encoding", ""],
  ["content-language", ""],
  ["content-length", ""],
  ["content-location", ""],
  ["content-range", ""],
  ["content-type", ""],
  ["cookie", ""],
  ["date", ""],
  ["etag", ""],
  ["expect", ""],
  ["expires", ""],
  ["from", ""],
  ["host", ""],
  ["if-match", ""],
  ["if-modified-since", ""],
  ["if-none-match", ""],
  ["if-range", ""],
  ["if-unmodified-since", ""],
  ["last-modified", ""],
  ["link", ""],
  ["location", ""],
  ["max-forwards", ""],
  ["proxy-authenticate", ""],
  ["proxy-authorization", ""],
  ["range", ""],
  ["referer", ""],
  ["refresh", ""],
  ["retry-after", ""],
  ["server", ""],
  ["set-cookie", ""],
  ["strict-transport-security", ""],
  ["transfer-encoding", ""],
  ["user-agent", ""],
  ["vary", ""],
  ["via", ""],
  ["www-authenticate", ""],
];

// The HeaderSetDecompressor class
// -------------------------------

// A `HeaderSetDecompressor` instance is a transform stream that can be used to *decompress a
// single header set*. Its input is a stream of binary data chunks and its output is a stream of
// `[name, value]` pairs.
//
// Currently, it is not a proper streaming decompressor implementation, since it buffer its input
// until the end os the stream, and then processes the whole header block at once.

//util.inherits(HeaderSetDecompressor, TransformStream);

export type HeaderItem = {
  name: string | number;
  value: string | number;
  index: boolean | number;

  mustNeverIndex?: boolean;
  contextUpdate?: boolean;
  newMaxSize?: number;

  chunks?: any[];
};

export class HeaderSetDecompressor extends Transform {
  _log = consoleLogger();
  _table: HeaderTable;
  _chunks: any[] = [];

  constructor(table: HeaderTable) {
    super({ objectMode: true });

    this._table = table;
    this._chunks = [];
  }

  // `_transform` is the implementation of the [corresponding virtual function][_transform] of the
  // TransformStream class. It collects the data chunks for later processing.
  // [_transform]: https://nodejs.org/api/stream.html#stream_transform_transform_chunk_encoding_callback
  _transform(chunk: any, encoding: string, callback: Function) {
    this._chunks.push(chunk);
    callback();
  }

  // `execute(rep)` executes the given [header representation][representation].
  // [representation]: https://tools.ietf.org/html/rfc7541#section-6

  // The *JavaScript object representation* of a header representation:
  //
  //     {
  //       name: String || Integer,  // string literal or index
  //       value: String || Integer, // string literal or index
  //       index: Boolean            // with or without indexing
  //     }
  //
  // *Important:* to ease the indexing of the header table, indexes start at 0 instead of 1.
  //
  // Examples:
  //
  //     Indexed:
  //     { name: 2  , value: 2  , index: false }
  //     Literal:
  //     { name: 2  , value: 'X', index: false } // without indexing
  //     { name: 2  , value: 'Y', index: true  } // with indexing
  //     { name: 'A', value: 'Z', index: true  } // with indexing, literal name
  _execute(rep: HeaderItem) {
    this._log.trace(
      { key: rep.name, value: rep.value, index: rep.index },
      "Executing header representation"
    );

    let entry;
    let pair;

    if (rep.contextUpdate) {
      this._table.setSizeLimit(rep.newMaxSize!);
    }

    // * An _indexed representation_ entails the following actions:
    //   * The header field corresponding to the referenced entry is emitted
    else if (typeof rep.value === "number") {
      const index = rep.value;
      entry = this._table[index];

      pair = entry.slice();
      this.push(pair);
    }

    // * A _literal representation_ that is _not added_ to the header table entails the following
    //   action:
    //   * The header is emitted.
    // * A _literal representation_ that is _added_ to the header table entails the following further
    //   actions:
    //   * The header is added to the header table.
    //   * The header is emitted.
    else {
      if (typeof rep.name === "number") {
        pair = [this._table[rep.name][0], rep.value];
      } else {
        pair = [rep.name, rep.value];
      }

      if (rep.index) {
        entry = entryFromPair(pair as HeaderTablePair);
        this._table.add(entry);
      }

      this.push(pair);
    }
  }

  // `_flush` is the implementation of the [corresponding virtual function][_flush] of the
  // TransformStream class. The whole decompressing process is done in `_flush`. It gets called when
  // the input stream is over.
  // [_flush]: https://nodejs.org/api/stream.html#stream_transform_flush_callback
  ["_flush" as string](callback: Function): void {
    const buffer = concat(this._chunks);

    // * processes the header representations
    (buffer as any).cursor = 0;
    while ((buffer as any).cursor < buffer.length) {
      this._execute(HeaderSetDecompressor.header(buffer));
    }

    callback();
  }

  // The inverse algorithm:
  //
  // 1. Set I to the number coded on the lower N bits of the first byte
  // 2. If I is smaller than 2^N - 1 then return I
  // 2. Else the number is encoded on more than one byte, so do the following steps:
  //    1. Set M to 0
  //    2. While returning with I
  //       1. Let B be the next byte (the first byte if N is 0)
  //       2. Read out the lower 7 bits of B and multiply it with 2^M
  //       3. Increase I with this number
  //       4. Increase M by 7
  //       5. Return I if the most significant bit of B is 0

  static integer(buffer: Buffer, N: number) {
    const limit = 2 ** N - 1;

    let I = buffer[(buffer as any).cursor] & limit;
    if (N !== 0) {
      (buffer as any).cursor += 1;
    }

    if (I === limit) {
      let M = 0;
      do {
        I += (buffer[(buffer as any).cursor] & 127) << M;
        M += 7;
        (buffer as any).cursor += 1;
      } while (buffer[(buffer as any).cursor - 1] & 128);
    }

    return I;
  }

  static string(buffer: Buffer) {
    const huffman = buffer[(buffer as any).cursor] & 128;
    const length = HeaderSetDecompressor.integer(buffer, 7);
    const encoded = buffer.slice(
      (buffer as any).cursor,
      (buffer as any).cursor + length
    );
    (buffer as any).cursor += length;
    return (huffman ? huffmanTable.decode(encoded) : encoded).toString("utf8");
  }

  static header(buffer: Buffer) {
    let representation;
    const header = {} as HeaderItem;

    const firstByte = buffer[(buffer as any).cursor];
    if (firstByte & 0x80) {
      representation = representations.indexed;
    } else if (firstByte & 0x40) {
      representation = representations.literalIncremental;
    } else if (firstByte & 0x20) {
      representation = representations.contextUpdate;
    } else if (firstByte & 0x10) {
      representation = representations.literalNeverIndexed;
    } else {
      representation = representations.literal;
    }

    header.value = header.name = -1;
    header.index = false;
    header.contextUpdate = false;
    header.newMaxSize = 0;
    header.mustNeverIndex = false;

    if (representation === representations.contextUpdate) {
      header.contextUpdate = true;
      header.newMaxSize = HeaderSetDecompressor.integer(buffer, 5);
    } else if (representation === representations.indexed) {
      header.value = header.name =
        HeaderSetDecompressor.integer(buffer, representation.prefix) - 1;
    } else {
      header.name =
        HeaderSetDecompressor.integer(buffer, representation.prefix) - 1;
      if (header.name === -1) {
        header.name = HeaderSetDecompressor.string(buffer);
      }
      header.value = HeaderSetDecompressor.string(buffer);
      header.index = representation === representations.literalIncremental;
      header.mustNeverIndex =
        representation === representations.literalNeverIndexed;
    }

    return header;
  }
}

// The HeaderSetCompressor class
// -----------------------------

// A `HeaderSetCompressor` instance is a transform stream that can be used to *compress a single
// header set*. Its input is a stream of `[name, value]` pairs and its output is a stream of
// binary data chunks.
//
// It is a real streaming compressor, since it does not wait until the header set is complete.
//
// The compression algorithm is (intentionally) not specified by the spec. Therefore, the current
// compression algorithm can probably be improved in the future.

//util.inherits(HeaderSetCompressor, TransformStream);

export class HeaderSetCompressor extends Transform {
  _log = consoleLogger();
  _table: HeaderTable;

  constructor(table: HeaderTable) {
    super({ objectMode: true });
    //TransformStream.call(this, { objectMode: true });

    this._table = table;
    //this.push = Transform.prototype.push.bind(this);
  }

  send(rep: HeaderItem) {
    this._log.trace(
      { key: rep.name, value: rep.value, index: rep.index },
      "Emitting header representation"
    );

    if (!rep.chunks) {
      rep.chunks = HeaderSetCompressor.header(rep);
    }
    rep.chunks.forEach((x) => this.push(x));
  }

  // `_transform` is the implementation of the [corresponding virtual function][_transform] of the
  // TransformStream class. It processes the input headers one by one:
  // [_transform]: https://nodejs.org/api/stream.html#stream_transform_transform_chunk_encoding_callback
  _transform(pair: HeaderTablePair, encoding: string, callback: Function) {
    const name = pair[0].toLowerCase();
    const value = pair[1];
    let entry;
    let rep;

    // * tries to find full (name, value) or name match in the header table
    let nameMatch = -1;

    let fullMatch = -1;
    for (
      let droppedIndex = 0;
      droppedIndex < this._table.length;
      droppedIndex++
    ) {
      entry = this._table[droppedIndex];
      if (entry[0] === name) {
        if (entry[1] === value) {
          fullMatch = droppedIndex;
          break;
        } else if (nameMatch === -1) {
          nameMatch = droppedIndex;
        }
      }
    }

    const mustNeverIndex =
      (name === "cookie" && value.length < 20) ||
      (name === "set-cookie" && value.length < 20) ||
      name === "authorization";

    if (fullMatch !== -1 && !mustNeverIndex) {
      this.send({ name: fullMatch, value: fullMatch, index: false });
    }

    // * otherwise, it will be a literal representation (with a name index if there's a name match)
    else {
      entry = entryFromPair(pair);

      const indexing = entry._size < this._table._limit / 2 && !mustNeverIndex;

      if (indexing) {
        this._table.add(entry);
      }

      this.send({
        name: nameMatch !== -1 ? nameMatch : name,
        value,
        index: indexing,
        mustNeverIndex,
        contextUpdate: false,
      });
    }

    callback();
  }

  // `_flush` is the implementation of the [corresponding virtual function][_flush] of the
  // TransformStream class. It gets called when there's no more header to compress. The final step:
  // [_flush]: https://nodejs.org/api/stream.html#stream_transform_flush_callback
  ["_flush" as string](callback: Function): void {
    callback();
  }

  // [Detailed Format](https://tools.ietf.org/html/rfc7541#section-5)
  // -----------------

  // ### Integer representation ###
  //
  // The algorithm to represent an integer I is as follows:
  //
  // 1. If I < 2^N - 1, encode I on N bits
  // 2. Else, encode 2^N - 1 on N bits and do the following steps:
  //    1. Set I to (I - (2^N - 1)) and Q to 1
  //    2. While Q > 0
  //       1. Compute Q and R, quotient and remainder of I divided by 2^7
  //       2. If Q is strictly greater than 0, write one 1 bit; otherwise, write one 0 bit
  //       3. Encode R on the next 7 bits
  //       4. I = Q

  static integer(I: number, N: number) {
    const limit = 2 ** N - 1;
    if (I < limit) {
      return [new Buffer([I])];
    }

    const bytes = [];
    if (N !== 0) {
      bytes.push(limit);
    }
    I -= limit;

    let Q = 1;
    let R;
    while (Q > 0) {
      Q = Math.floor(I / 128);
      R = I % 128;

      if (Q > 0) {
        R += 128;
      }
      bytes.push(R);

      I = Q;
    }

    return [new Buffer(bytes)];
  }

  // ### String literal representation ###
  //
  // Literal **strings** can represent header names or header values. There's two variant of the
  // string encoding:
  //
  // String literal with Huffman encoding:
  //
  //       0   1   2   3   4   5   6   7
  //     +---+---+---+---+---+---+---+---+
  //     | 1 |  Value Length Prefix (7)  |
  //     +---+---+---+---+---+---+---+---+
  //     |   Value Length (0-N bytes)    |
  //     +---+---+---+---+---+---+---+---+
  //     ...
  //     +---+---+---+---+---+---+---+---+
  //     | Huffman Encoded Data  |Padding|
  //     +---+---+---+---+---+---+---+---+
  //
  // String literal without Huffman encoding:
  //
  //       0   1   2   3   4   5   6   7
  //     +---+---+---+---+---+---+---+---+
  //     | 0 |  Value Length Prefix (7)  |
  //     +---+---+---+---+---+---+---+---+
  //     |   Value Length (0-N bytes)    |
  //     +---+---+---+---+---+---+---+---+
  //     ...
  //     +---+---+---+---+---+---+---+---+
  //     |  Field Bytes Without Encoding |
  //     +---+---+---+---+---+---+---+---+

  static string(_str: string) {
    const str = Buffer.from(_str, "utf8");

    const huffman = huffmanTable.encode(str);
    if (huffman.length < str.length) {
      var length = HeaderSetCompressor.integer(huffman.length, 7);
      length[0][0] |= 128;
      return length.concat(huffman);
    } else {
      length = HeaderSetCompressor.integer(str.length, 7);
      return length.concat(str);
    }
  }

  static header(header: HeaderItem) {
    let representation;
    const buffers = [];

    if (header.contextUpdate) {
      representation = representations.contextUpdate;
    } else if (typeof header.value === "number") {
      representation = representations.indexed;
    } else if (header.index) {
      representation = representations.literalIncremental;
    } else if (header.mustNeverIndex) {
      representation = representations.literalNeverIndexed;
    } else {
      representation = representations.literal;
    }

    if (representation === representations.contextUpdate) {
      buffers.push(HeaderSetCompressor.integer(header.newMaxSize!, 5));
    } else if (representation === representations.indexed) {
      buffers.push(
        HeaderSetCompressor.integer(+header.value + 1, representation.prefix)
      );
    } else {
      if (typeof header.name === "number") {
        buffers.push(
          HeaderSetCompressor.integer(header.name + 1, representation.prefix)
        );
      } else {
        buffers.push(HeaderSetCompressor.integer(0, representation.prefix));
        buffers.push(HeaderSetCompressor.string(header.name));
      }
      buffers.push(HeaderSetCompressor.string(header.value.toString()));
    }

    buffers[0][0][0] |= representation.pattern;

    return Array.prototype.concat.apply([], buffers); // array of arrays of buffers -> array of buffers
  }
}

// ### Huffman Encoding ###

export class HuffmanTable {
  tree: any;

  codes: number[];
  lengths: number[];

  constructor(table: string[]) {
    function createTree(codes: string[], position?: number): any {
      if (codes.length === 1) {
        return [table.indexOf(codes[0])];
      } else {
        position = position || 0;
        const zero = [];
        const one = [];
        for (let i = 0; i < codes.length; i++) {
          const string = codes[i];
          if (string[position] === "0") {
            zero.push(string);
          } else {
            one.push(string);
          }
        }
        return [createTree(zero, position + 1), createTree(one, position + 1)];
      }
    }

    this.tree = createTree(table);

    this.codes = table.map((bits) => parseInt(bits, 2));
    this.lengths = table.map(({ length }) => length);
  }

  encode(buffer: Buffer) {
    const result: number[] = [];
    let space = 8;

    function add(data: number) {
      if (space === 8) {
        result.push(data);
      } else {
        result[result.length - 1] |= data;
      }
    }

    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      let code = this.codes[byte];
      let length = this.lengths[byte];

      while (length !== 0) {
        if (space >= length) {
          add(code << (space - length));
          code = 0;
          space -= length;
          length = 0;
        } else {
          const shift = length - space;
          const msb = code >> shift;
          add(msb);
          code -= msb << shift;
          length -= space;
          space = 0;
        }

        if (space === 0) {
          space = 8;
        }
      }
    }

    if (space !== 8) {
      add(this.codes[256] >> (this.lengths[256] - space));
    }

    return new Buffer(result);
  }

  decode(buffer: Buffer) {
    const result = [];
    let subtree = this.tree;

    for (let i = 0; i < buffer.length; i++) {
      let byte = buffer[i];

      for (let j = 0; j < 8; j++) {
        const bit = byte & 128 ? 1 : 0;
        byte = byte << 1;

        subtree = subtree[bit];
        if (subtree.length === 1) {
          result.push(subtree[0]);
          subtree = this.tree;
        }
      }
    }

    return new Buffer(result);
  }
}

// The initializer arrays for the Huffman tables are generated with feeding the tables from the
// spec to this sed command:
//
//     sed -e "s/^.* [|]//g" -e "s/|//g" -e "s/ .*//g" -e "s/^/  '/g" -e "s/$/',/g"

export const huffmanTable = new HuffmanTable([
  "1111111111000",
  "11111111111111111011000",
  "1111111111111111111111100010",
  "1111111111111111111111100011",
  "1111111111111111111111100100",
  "1111111111111111111111100101",
  "1111111111111111111111100110",
  "1111111111111111111111100111",
  "1111111111111111111111101000",
  "111111111111111111101010",
  "111111111111111111111111111100",
  "1111111111111111111111101001",
  "1111111111111111111111101010",
  "111111111111111111111111111101",
  "1111111111111111111111101011",
  "1111111111111111111111101100",
  "1111111111111111111111101101",
  "1111111111111111111111101110",
  "1111111111111111111111101111",
  "1111111111111111111111110000",
  "1111111111111111111111110001",
  "1111111111111111111111110010",
  "111111111111111111111111111110",
  "1111111111111111111111110011",
  "1111111111111111111111110100",
  "1111111111111111111111110101",
  "1111111111111111111111110110",
  "1111111111111111111111110111",
  "1111111111111111111111111000",
  "1111111111111111111111111001",
  "1111111111111111111111111010",
  "1111111111111111111111111011",
  "010100",
  "1111111000",
  "1111111001",
  "111111111010",
  "1111111111001",
  "010101",
  "11111000",
  "11111111010",
  "1111111010",
  "1111111011",
  "11111001",
  "11111111011",
  "11111010",
  "010110",
  "010111",
  "011000",
  "00000",
  "00001",
  "00010",
  "011001",
  "011010",
  "011011",
  "011100",
  "011101",
  "011110",
  "011111",
  "1011100",
  "11111011",
  "111111111111100",
  "100000",
  "111111111011",
  "1111111100",
  "1111111111010",
  "100001",
  "1011101",
  "1011110",
  "1011111",
  "1100000",
  "1100001",
  "1100010",
  "1100011",
  "1100100",
  "1100101",
  "1100110",
  "1100111",
  "1101000",
  "1101001",
  "1101010",
  "1101011",
  "1101100",
  "1101101",
  "1101110",
  "1101111",
  "1110000",
  "1110001",
  "1110010",
  "11111100",
  "1110011",
  "11111101",
  "1111111111011",
  "1111111111111110000",
  "1111111111100",
  "11111111111100",
  "100010",
  "111111111111101",
  "00011",
  "100011",
  "00100",
  "100100",
  "00101",
  "100101",
  "100110",
  "100111",
  "00110",
  "1110100",
  "1110101",
  "101000",
  "101001",
  "101010",
  "00111",
  "101011",
  "1110110",
  "101100",
  "01000",
  "01001",
  "101101",
  "1110111",
  "1111000",
  "1111001",
  "1111010",
  "1111011",
  "111111111111110",
  "11111111100",
  "11111111111101",
  "1111111111101",
  "1111111111111111111111111100",
  "11111111111111100110",
  "1111111111111111010010",
  "11111111111111100111",
  "11111111111111101000",
  "1111111111111111010011",
  "1111111111111111010100",
  "1111111111111111010101",
  "11111111111111111011001",
  "1111111111111111010110",
  "11111111111111111011010",
  "11111111111111111011011",
  "11111111111111111011100",
  "11111111111111111011101",
  "11111111111111111011110",
  "111111111111111111101011",
  "11111111111111111011111",
  "111111111111111111101100",
  "111111111111111111101101",
  "1111111111111111010111",
  "11111111111111111100000",
  "111111111111111111101110",
  "11111111111111111100001",
  "11111111111111111100010",
  "11111111111111111100011",
  "11111111111111111100100",
  "111111111111111011100",
  "1111111111111111011000",
  "11111111111111111100101",
  "1111111111111111011001",
  "11111111111111111100110",
  "11111111111111111100111",
  "111111111111111111101111",
  "1111111111111111011010",
  "111111111111111011101",
  "11111111111111101001",
  "1111111111111111011011",
  "1111111111111111011100",
  "11111111111111111101000",
  "11111111111111111101001",
  "111111111111111011110",
  "11111111111111111101010",
  "1111111111111111011101",
  "1111111111111111011110",
  "111111111111111111110000",
  "111111111111111011111",
  "1111111111111111011111",
  "11111111111111111101011",
  "11111111111111111101100",
  "111111111111111100000",
  "111111111111111100001",
  "1111111111111111100000",
  "111111111111111100010",
  "11111111111111111101101",
  "1111111111111111100001",
  "11111111111111111101110",
  "11111111111111111101111",
  "11111111111111101010",
  "1111111111111111100010",
  "1111111111111111100011",
  "1111111111111111100100",
  "11111111111111111110000",
  "1111111111111111100101",
  "1111111111111111100110",
  "11111111111111111110001",
  "11111111111111111111100000",
  "11111111111111111111100001",
  "11111111111111101011",
  "1111111111111110001",
  "1111111111111111100111",
  "11111111111111111110010",
  "1111111111111111101000",
  "1111111111111111111101100",
  "11111111111111111111100010",
  "11111111111111111111100011",
  "11111111111111111111100100",
  "111111111111111111111011110",
  "111111111111111111111011111",
  "11111111111111111111100101",
  "111111111111111111110001",
  "1111111111111111111101101",
  "1111111111111110010",
  "111111111111111100011",
  "11111111111111111111100110",
  "111111111111111111111100000",
  "111111111111111111111100001",
  "11111111111111111111100111",
  "111111111111111111111100010",
  "111111111111111111110010",
  "111111111111111100100",
  "111111111111111100101",
  "11111111111111111111101000",
  "11111111111111111111101001",
  "1111111111111111111111111101",
  "111111111111111111111100011",
  "111111111111111111111100100",
  "111111111111111111111100101",
  "11111111111111101100",
  "111111111111111111110011",
  "11111111111111101101",
  "111111111111111100110",
  "1111111111111111101001",
  "111111111111111100111",
  "111111111111111101000",
  "11111111111111111110011",
  "1111111111111111101010",
  "1111111111111111101011",
  "1111111111111111111101110",
  "1111111111111111111101111",
  "111111111111111111110100",
  "111111111111111111110101",
  "11111111111111111111101010",
  "11111111111111111110100",
  "11111111111111111111101011",
  "111111111111111111111100110",
  "11111111111111111111101100",
  "11111111111111111111101101",
  "111111111111111111111100111",
  "111111111111111111111101000",
  "111111111111111111111101001",
  "111111111111111111111101010",
  "111111111111111111111101011",
  "1111111111111111111111111110",
  "111111111111111111111101100",
  "111111111111111111111101101",
  "111111111111111111111101110",
  "111111111111111111111101111",
  "111111111111111111111110000",
  "11111111111111111111101110",
  "111111111111111111111111111111",
]);

// ### Header represenations ###

// The JavaScript object representation is described near the
// `HeaderSetDecompressor.prototype._execute()` method definition.
//
// **All binary header representations** start with a prefix signaling the representation type and
// an index represented using prefix coded integers:
//
//       0   1   2   3   4   5   6   7
//     +---+---+---+---+---+---+---+---+
//     | 1 |        Index (7+)         |  Indexed Representation
//     +---+---------------------------+
//
//       0   1   2   3   4   5   6   7
//     +---+---+---+---+---+---+---+---+
//     | 0 | 1 |      Index (6+)       |
//     +---+---+---+-------------------+  Literal w/ Indexing
//     |       Value Length (8+)       |
//     +-------------------------------+  w/ Indexed Name
//     | Value String (Length octets)  |
//     +-------------------------------+
//
//       0   1   2   3   4   5   6   7
//     +---+---+---+---+---+---+---+---+
//     | 0 | 1 |           0           |
//     +---+---+---+-------------------+
//     |       Name Length (8+)        |
//     +-------------------------------+  Literal w/ Indexing
//     |  Name String (Length octets)  |
//     +-------------------------------+  w/ New Name
//     |       Value Length (8+)       |
//     +-------------------------------+
//     | Value String (Length octets)  |
//     +-------------------------------+
//
//       0   1   2   3   4   5   6   7
//     +---+---+---+---+---+---+---+---+
//     | 0 | 0 | 0 | 0 |  Index (4+)   |
//     +---+---+---+-------------------+  Literal w/o Incremental Indexing
//     |       Value Length (8+)       |
//     +-------------------------------+  w/ Indexed Name
//     | Value String (Length octets)  |
//     +-------------------------------+
//
//       0   1   2   3   4   5   6   7
//     +---+---+---+---+---+---+---+---+
//     | 0 | 0 | 0 | 0 |       0       |
//     +---+---+---+-------------------+
//     |       Name Length (8+)        |
//     +-------------------------------+  Literal w/o Incremental Indexing
//     |  Name String (Length octets)  |
//     +-------------------------------+  w/ New Name
//     |       Value Length (8+)       |
//     +-------------------------------+
//     | Value String (Length octets)  |
//     +-------------------------------+
//
//       0   1   2   3   4   5   6   7
//     +---+---+---+---+---+---+---+---+
//     | 0 | 0 | 0 | 1 |  Index (4+)   |
//     +---+---+---+-------------------+  Literal never indexed
//     |       Value Length (8+)       |
//     +-------------------------------+  w/ Indexed Name
//     | Value String (Length octets)  |
//     +-------------------------------+
//
//       0   1   2   3   4   5   6   7
//     +---+---+---+---+---+---+---+---+
//     | 0 | 0 | 0 | 1 |       0       |
//     +---+---+---+-------------------+
//     |       Name Length (8+)        |
//     +-------------------------------+  Literal never indexed
//     |  Name String (Length octets)  |
//     +-------------------------------+  w/ New Name
//     |       Value Length (8+)       |
//     +-------------------------------+
//     | Value String (Length octets)  |
//     +-------------------------------+
//
// The **Indexed Representation** consists of the 1-bit prefix and the Index that is represented as
// a 7-bit prefix coded integer and nothing else.
//
// After the first bits, **all literal representations** specify the header name, either as a
// pointer to the Header Table (Index) or a string literal. When the string literal representation
// is used, the Index is set to 0 and the string literal starts at the second byte.
//
// For **all literal representations**, the specification of the header value comes next. It is
// always represented as a string.

const representations = {
  indexed: { prefix: 7, pattern: 0x80 },
  literalIncremental: { prefix: 6, pattern: 0x40 },
  contextUpdate: { prefix: 0, pattern: 0x20 },
  literalNeverIndexed: { prefix: 4, pattern: 0x10 },
  literal: { prefix: 4, pattern: 0x00 },
};

// Integration with HTTP/2
// =======================

// This section describes the interaction between the compressor/decompressor and the rest of the
// HTTP/2 implementation. The `Compressor` and the `Decompressor` makes up a layer between the
// [framer](framer.html) and the [connection handling component](connection.html). They let most
// frames pass through, except HEADERS and PUSH_PROMISE frames. They convert the frames between
// these two representations:
//
//     {                                   {
//      type: 'HEADERS',                    type: 'HEADERS',
//      flags: {},                          flags: {},
//      stream: 1,               <===>      stream: 1,
//      headers: {                          data: Buffer
//       N1: 'V1',                         }
//       N2: ['V1', 'V2', ...],
//       // ...
//      }
//     }
//
// There are possibly several binary frame that belong to a single non-binary frame.

const MAX_HTTP_PAYLOAD_SIZE = 16384;

// The Compressor class
// --------------------

// The Compressor transform stream is basically stateless.
//util.inherits(Compressor, TransformStream);

export class Compressor extends Transform {
  _table: HeaderTable;

  tableSizeChangePending = false;
  lowestTableSizePending = 0;
  tableSizeSetting = DEFAULT_HEADER_TABLE_LIMIT;

  constructor(type: string) {
    super({ objectMode: true });

    assert(type === "REQUEST" || type === "RESPONSE");
    this._table = new HeaderTable();
  }

  // Changing the header table size
  setTableSizeLimit(size: number) {
    this._table.setSizeLimit(size);
    if (!this.tableSizeChangePending || size < this.lowestTableSizePending) {
      this.lowestTableSizePending = size;
    }
    this.tableSizeSetting = size;
    this.tableSizeChangePending = true;
  }

  // `compress` takes a header set, and compresses it using a new `HeaderSetCompressor` stream
  // instance. This means that from now on, the advantages of streaming header encoding are lost,
  // but the API becomes simpler.
  compress(headers: Record<string, string>) {
    const compressor = new HeaderSetCompressor(this._table);

    if (this.tableSizeChangePending) {
      if (this.lowestTableSizePending < this.tableSizeSetting) {
        compressor.send({
          contextUpdate: true,
          newMaxSize: this.lowestTableSizePending,
          name: "",
          value: "",
          index: 0,
        });
      }
      compressor.send({
        contextUpdate: true,
        newMaxSize: this.tableSizeSetting,
        name: "",
        value: "",
        index: 0,
      });
      this.tableSizeChangePending = false;
    }
    const colonHeaders = [];
    const nonColonHeaders = [];

    // To ensure we send colon headers first
    for (const name in headers) {
      if (name.trim()[0] === ":") {
        colonHeaders.push(name);
      } else {
        nonColonHeaders.push(name);
      }
    }

    function compressHeader(name: string) {
      let value = headers[name] as any;
      name = String(name).toLowerCase();

      // * To allow for better compression efficiency, the Cookie header field MAY be split into
      //   separate header fields, each with one or more cookie-pairs.
      if (name == "cookie") {
        if (!(value instanceof Array)) {
          value = [value];
        }
        value = Array.prototype.concat.apply(
          [],
          value.map((cookie: any) => String(cookie).split(";").map(trim))
        );
      }

      if (value instanceof Array) {
        for (let i = 0; i < value.length; i++) {
          compressor.write([name, String(value[i])]);
        }
      } else {
        compressor.write([name, String(value)]);
      }
    }

    colonHeaders.forEach(compressHeader);
    nonColonHeaders.forEach(compressHeader);

    compressor.end();

    let chunk;
    const chunks = [];
    while ((chunk = compressor.read())) {
      chunks.push(chunk);
    }
    return concat(chunks as any);
  }

  // When a `frame` arrives
  _transform(frame: Frame, encoding: string, done: Function) {
    // * and it is a HEADERS or PUSH_PROMISE frame
    //   * it generates a header block using the compress method
    //   * cuts the header block into `chunks` that are not larger than `MAX_HTTP_PAYLOAD_SIZE`
    //   * for each chunk, it pushes out a chunk frame that is identical to the original, except
    //     the `data` property which holds the given chunk, the type of the frame which is always
    //     CONTINUATION except for the first frame, and the END_HEADERS/END_PUSH_STREAM flag that
    //     marks the last frame and the END_STREAM flag which is always false before the end
    if (frame.type === "HEADERS" || frame.type === "PUSH_PROMISE") {
      const buffer = this.compress(frame.headers);

      console.log("Compressor.prototype._transform frame", frame);
      console.log(
        "Compressor.prototype._transform buffer",
        buffer.toString("hex")
      );

      // This will result in CONTINUATIONs from a PUSH_PROMISE being 4 bytes shorter than they could
      // be, but that's not the end of the world, and it prevents us from going over MAX_HTTP_PAYLOAD_SIZE
      // on the initial PUSH_PROMISE frame.
      const adjustment = frame.type === "PUSH_PROMISE" ? 4 : 0;
      const chunks = cut(buffer, MAX_HTTP_PAYLOAD_SIZE - adjustment);

      for (let i = 0; i < chunks.length; i++) {
        let chunkFrame: Frame;
        const first = i === 0;
        const last = i === chunks.length - 1;

        if (first) {
          chunkFrame = Object.assign({}, frame);
          chunkFrame.flags = Object.assign({}, frame.flags);
          chunkFrame.flags[`END_${frame.type}`] = last;
        } else {
          chunkFrame = ({
            type: "CONTINUATION",
            flags: { END_HEADERS: last },
            stream: frame.stream,
          } as any) as Frame;
        }
        chunkFrame.data = chunks[i];

        this.push(chunkFrame);
      }
    }

    // * otherwise, the frame is forwarded without taking any action
    else {
      this.push(frame);
    }

    done();
  }
}

// The Decompressor class
// ----------------------

// The Decompressor is a stateful transform stream, since it has to collect multiple frames first,
// and the decoding comes after unifying the payload of those frames.
//
// If there's a frame in progress, `this._inProgress` is `true`. The frames are collected in
// `this._frames`, and the type of the frame and the stream identifier is stored in `this._type`
// and `this._stream` respectively.
///util.inherits(Decompressor, TransformStream);

export class Decompressor extends Transform {
  _log = consoleLogger();
  _table: HeaderTable;

  _inProgress = false;
  _base: any = undefined;

  _frames: any;

  constructor(type: string) {
    super({ objectMode: true });

    assert(type === "REQUEST" || type === "RESPONSE");
    this._table = new HeaderTable();
  }

  // Changing the header table size
  setTableSizeLimit(size: number) {
    this._table.setSizeLimit(size);
  }

  // `decompress` takes a full header block, and decompresses it using a new `HeaderSetDecompressor`
  // stream instance. This means that from now on, the advantages of streaming header decoding are
  // lost, but the API becomes simpler.
  decompress(block: any) {
    const decompressor = new HeaderSetDecompressor(this._table);
    decompressor.end(block);

    let seenNonColonHeader = false;
    const headers = {} as Record<string, any>;
    let pair;
    while ((pair = decompressor.read())) {
      const name = pair[0];
      const value = pair[1];
      const isColonHeader = name.toString().trim()[0] === ":";
      if (seenNonColonHeader && isColonHeader) {
        this.emit("error", "PROTOCOL_ERROR");
        return headers;
      }
      seenNonColonHeader = !isColonHeader;
      if (name in headers) {
        if (headers[name] instanceof Array) {
          headers[name].push(value);
        } else {
          headers[name] = [headers[name], value];
        }
      } else {
        headers[name] = value;
      }
    }

    // * If there are multiple Cookie header fields after decompression, these MUST be concatenated
    //   into a single octet string using the two octet delimiter of 0x3B, 0x20 (the ASCII
    //   string "; ").
    if ("cookie" in headers && headers["cookie"] instanceof Array) {
      headers["cookie"] = headers["cookie"].join("; ");
    }

    return headers;
  }

  // When a `frame` arrives
  _transform(frame: Frame, encoding: string, done: Function) {
    // * and the collection process is already `_inProgress`, the frame is simply stored, except if
    //   it's an illegal frame
    if (this._inProgress) {
      if (frame.type !== "CONTINUATION" || frame.stream !== this._base.stream) {
        this._log.error("A series of HEADER frames were not continuous");
        this.emit("error", "PROTOCOL_ERROR");
        return;
      }
      this._frames.push(frame);
    }

    // * and the collection process is not `_inProgress`, but the new frame's type is HEADERS or
    //   PUSH_PROMISE, a new collection process begins
    else if (frame.type === "HEADERS" || frame.type === "PUSH_PROMISE") {
      this._inProgress = true;
      this._base = Object.assign({}, frame);
      this._frames = [frame];
    }

    // * otherwise, the frame is forwarded without taking any action
    else {
      this.push(frame);
    }

    // * When the frame signals that it's the last in the series, the header block chunks are
    //   concatenated, the headers are decompressed, and a new frame gets pushed out with the
    //   decompressed headers.
    if (
      this._inProgress &&
      (frame.flags.END_HEADERS || frame.flags.END_PUSH_PROMISE)
    ) {
      const buffer = concat(this._frames.map(({ data }: any) => data));
      try {
        var headers = this.decompress(buffer);
      } catch (error) {
        this._log.error({ err: error }, "Header decompression error");
        this.emit("error", "COMPRESSION_ERROR");
        return;
      }
      this.push(Object.assign({}, this._base, { headers }));
      this._inProgress = false;
    }

    done();
  }
}

// Helper functions
// ================

// Concatenate an array of buffers into a new buffer
function concat(buffers: Buffer[]) {
  let size = 0;
  for (let i = 0; i < buffers.length; i++) {
    size += buffers[i].length;
  }

  const concatenated = new Buffer(size);
  for (
    let cursor = 0, j = 0;
    j < buffers.length;
    cursor += buffers[j].length, j++
  ) {
    buffers[j].copy(concatenated, cursor);
  }

  return concatenated;
}

// Cut `buffer` into chunks not larger than `size`
function cut(buffer: Buffer, size: number) {
  const chunks = [];
  let cursor = 0;
  do {
    const chunkSize = Math.min(size, buffer.length - cursor);
    chunks.push(buffer.slice(cursor, cursor + chunkSize));
    cursor += chunkSize;
  } while (cursor < buffer.length);
  return chunks;
}

function trim(string: any) {
  return string.trim();
}
