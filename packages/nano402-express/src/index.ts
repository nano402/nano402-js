// Re-export everything from core
export * from "nano402";

// Export Express-specific middleware
export { nano402Guard } from "./express";
export type { Nano402GuardOptions } from "./express";

