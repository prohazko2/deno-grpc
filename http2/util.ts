export const logData = false;

export const noop = () => {};
export const consoleLogger = () => ({
  debug: (...args: any[]) => (logData ? console.log(...args) : noop()),
  trace: (...args: any[]) => (logData ? console.log(...args) : noop()),
  error: (...args: any[]) => (logData ? console.error(...args) : noop()),
});
