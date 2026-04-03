// Type augmentation for @cloudflare/vitest-pool-workers
// so `env` from "cloudflare:test" exposes our bindings.

declare module "cloudflare:test" {
  interface ProvidedEnv {
    CONFIG_KV: KVNamespace;
    QUEUE_DO: DurableObjectNamespace;
  }
}
