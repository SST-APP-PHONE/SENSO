import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach } from "vitest";
import { closeDBForTests } from "../../src/offline/db";

/** Conectividad simulada (navigator.onLine). */
let online = true;
Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });

export function setOnline(value: boolean) {
  online = value;
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}

beforeEach(async () => {
  online = true;
  await closeDBForTests();
  // IndexedDB nueva y vacía para cada prueba.
  globalThis.indexedDB = new IDBFactory();
});

afterEach(async () => {
  await closeDBForTests();
});
