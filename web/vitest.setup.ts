import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom has no EventSource; useReview opens one when a review loads. This stub is
// constructable and records instances so a test can fire an SSE ping via `onmessage`.
class MockEventSource {
  static OPEN = 1;
  static instances: MockEventSource[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  readyState = 0;
  url: string;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close() {}
}
(globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;

afterEach(() => {
  cleanup();
  MockEventSource.instances = [];
});
