const globalObject = (typeof globalThis !== "undefined" ? globalThis : window) as {
  process?: { env?: Record<string, string> };
  global?: unknown;
};

if (!globalObject.process) {
  globalObject.process = { env: { NODE_ENV: "production" } };
} else {
  const env = globalObject.process.env ?? {};
  if (!("NODE_ENV" in env)) {
    env.NODE_ENV = "production";
  }
  globalObject.process.env = env;
}

if (!globalObject.global) {
  globalObject.global = globalObject;
}

