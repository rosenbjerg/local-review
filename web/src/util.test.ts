import { expect, test } from "vitest";
import { isApplePlatform } from "./util";

test("names ⌘ on Apple platforms, both the legacy and the client-hint spelling", () => {
  expect(["MacIntel", "macOS", "iPhone", "iPad"].every(isApplePlatform)).toBe(true);
  expect(["Win32", "Windows", "Linux x86_64", "Linux", ""].some(isApplePlatform)).toBe(false);
});
