import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

export interface ProcessInfo {
  pid: number;
  ppid?: number | null;
  name?: string | null;
  command?: string | null;
  memory?: number | null;
  cpu?: number | null;
  [key: string]: unknown;
}

export interface CreateProcessStreamOptions {
  backend?: 'dotnet';
  fields?: string[];
}

export interface ProcessStream extends Readable {
  process: ChildProcess;
  on(event: 'stderr', listener: (chunk: Buffer | string) => void): this;
  on(event: 'parseError', listener: (err: Error) => void): this;
  on(event: 'line', listener: (obj: ProcessInfo) => void): this;
}

export function createProcessStream(
  options?: CreateProcessStreamOptions,
): ProcessStream;