// The channel plane's transport over the connection the Host already holds.
//
// A Host is private: no public address, nothing dials in. The daemon opens one
// socket to the Hub at enrollment and keeps it alive itself — reconnect,
// backoff and relay staleness are all owned over there. The daemon attaches
// that socket as a full session on its side, so every session RPC the app can
// make, the Hub can make here.
//
// The alternative, dialing the daemon back from the Hub (`ws-client.ts`), has
// to cross the relay for a private Host, and the Hub cannot tell a working
// socket from one whose far side has gone: it kept sending into a dead pipe for
// 29 minutes on 2026-09-20 while every create died on its 30s timeout. Here the
// Hub is the server for the socket, so "is the Host there" is a fact it already
// holds, and a Host that is away fails the call at once instead of stalling.

import type { DaemonSessionChannel } from "../../daemons/protocol.js";
import { DaemonSessionProtocol, type DaemonSessionFrame } from "./session-protocol.js";

export interface EnrolledDaemonClientOptions {
  /** This Host's live session channel, or `undefined` while it is away. */
  resolveChannel: () => DaemonSessionChannel | undefined;
  /** Session frames from this Host, across its reconnects. */
  subscribe: (handler: (message: Record<string, unknown>) => void) => () => void;
  /** The Host's socket came back: a waiter is released and the state is logged. */
  onHostConnected?: (handler: () => void) => () => void;
  /** The Host's socket went: what is in flight on it will never answer. */
  onHostDisconnected?: (handler: () => void) => () => void;
  onStateChange?: (state: "connected" | "disconnected") => void;
  rpcTimeoutMs?: number;
  onStream?: (payload: { agentId: string; event: unknown; seq?: number }) => void;
  onAgentUpdate?: (agent: unknown) => void;
  onSubagentUpdate?: (frame: unknown) => void;
}

/** A Host that is not connected has nothing to wait for; say so in one word. */
export const HOST_NOT_CONNECTED = "host_not_connected";

export class EnrolledDaemonClient {
  private readonly protocol: DaemonSessionProtocol;
  private readonly teardown: (() => void)[] = [];
  private started = false;
  private stopped = false;

  constructor(private readonly options: EnrolledDaemonClientOptions) {
    this.protocol = new DaemonSessionProtocol({
      write: (frame) => this.write(frame),
      ...(options.rpcTimeoutMs === undefined ? {} : { rpcTimeoutMs: options.rpcTimeoutMs }),
      ...(options.onStream === undefined ? {} : { onStream: options.onStream }),
      ...(options.onAgentUpdate === undefined ? {} : { onAgentUpdate: options.onAgentUpdate }),
      ...(options.onSubagentUpdate === undefined
        ? {}
        : { onSubagentUpdate: options.onSubagentUpdate }),
    });
  }

  get connected(): boolean {
    return !this.stopped && this.options.resolveChannel() !== undefined;
  }

  get serverInfo(): Record<string, unknown> | undefined {
    return this.options.resolveChannel()?.serverInfo;
  }

  connect(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.teardown.push(
      this.options.subscribe((message) => {
        this.protocol.receive(message as DaemonSessionFrame);
      }),
    );
    const onConnected = this.options.onHostConnected;
    if (onConnected !== undefined) {
      this.teardown.push(onConnected(() => this.options.onStateChange?.("connected")));
    }
    const onDisconnected = this.options.onHostDisconnected;
    if (onDisconnected !== undefined) {
      // The Host is gone, so nothing in flight on that socket will answer. Fail
      // it now rather than at the RPC timeout: that stall is the whole reason
      // the plane stopped dialing out.
      this.teardown.push(
        onDisconnected(() => {
          this.options.onStateChange?.("disconnected");
          this.protocol.rejectAll(new Error(HOST_NOT_CONNECTED));
        }),
      );
    }
  }

  stop(): void {
    this.stopped = true;
    for (const release of this.teardown.splice(0)) release();
    this.protocol.rejectAll(new Error("daemon client stopped"));
  }

  call(requestType: string, fields: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    if (!this.connected) return Promise.reject(new Error(HOST_NOT_CONNECTED));
    return this.protocol.call(requestType, fields, timeoutMs);
  }

  send(message: Record<string, unknown>): Promise<void> {
    if (!this.connected) return Promise.reject(new Error(HOST_NOT_CONNECTED));
    return this.protocol.send(message);
  }

  /** Resolve once this Host is connected. Rejects on the wait timeout only. */
  waitForConnected(timeoutMs = 15_000): Promise<void> {
    if (this.connected) return Promise.resolve();
    const observe = this.options.onHostConnected;
    if (observe === undefined) return Promise.reject(new Error(HOST_NOT_CONNECTED));
    return new Promise((resolve, reject) => {
      const done = (settle: () => void): void => {
        clearTimeout(timer);
        release();
        settle();
      };
      const release = observe(() => done(resolve));
      const timer = setTimeout(() => {
        done(() => reject(new Error(`timed out waiting for Host connection after ${timeoutMs}ms`)));
      }, timeoutMs);
      timer.unref?.();
      if (this.connected) done(resolve);
    });
  }

  private write(frame: string): Promise<void> {
    const channel = this.options.resolveChannel();
    if (channel === undefined) return Promise.reject(new Error(HOST_NOT_CONNECTED));
    return channel.write(frame);
  }
}
