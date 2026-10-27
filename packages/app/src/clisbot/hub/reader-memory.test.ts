import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useReaderMemory, type RememberedReader } from "./reader-memory";

const STORAGE_KEY = "clisbot-hub-readers";
const hubA: RememberedReader = {
  origin: "https://a.example",
  aliases: [],
  id: "u-a",
  memberId: "m-a",
};
const hubB: RememberedReader = {
  origin: "https://b.example",
  aliases: [],
  id: "u-b",
  memberId: null,
};
const store = () => useReaderMemory.getState();
const stored = async () => {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? Object.keys(JSON.parse(raw).state.readers) : null;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Holds the next read of the persisted readers until `release` runs, like a slow AsyncStorage. */
function holdNextRead() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const real = vi.mocked(AsyncStorage.getItem).getMockImplementation()!;
  vi.mocked(AsyncStorage.getItem).mockImplementationOnce(async (key: string) => {
    await gate;
    return real(key);
  });
  return release;
}

async function seedStorage(readers: RememberedReader[]) {
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      state: { readers: Object.fromEntries(readers.map((entry) => [entry.origin, entry])) },
      version: 1,
    }),
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  useReaderMemory.setState({ readers: {}, signedOut: {} });
});

describe("sign-out", () => {
  it("wins over an account answer that still says signed in", () => {
    store().remember(hubA);
    store().forget(hubA.origin);
    // The stale `account.data` (or a refetch that failed) is observed again.
    store().remember(hubA);
    expect(store().readers).toEqual({});
  });

  it("holds while the Hub cannot answer, and ends when it confirms the account is signed out", () => {
    store().remember(hubA);
    store().forget(hubA.origin);
    store().remember(hubA);
    expect(store().readers).toEqual({});
    store().confirmSignedOut(hubA.origin);
    // From here a signed-in answer is a new sign-in.
    store().remember(hubA);
    expect(Object.keys(store().readers)).toEqual([hubA.origin]);
  });

  it("forgets only the Hub that signed out", () => {
    store().remember(hubA);
    store().remember(hubB);
    store().forget(hubA.origin);
    expect(Object.keys(store().readers)).toEqual([hubB.origin]);
  });
});

describe("hydrating the stored readers", () => {
  it("does not bring back a reader signed out while the store was still loading", async () => {
    await seedStorage([hubA, hubB]);
    const release = holdNextRead();
    const hydrated = useReaderMemory.persist.rehydrate();
    store().forget(hubA.origin);
    release();
    await hydrated;
    await settle();
    expect(Object.keys(store().readers)).toEqual([hubB.origin]);
    // The forgotten reader is gone from storage too, not only from memory.
    expect(await stored()).toEqual([hubB.origin]);
  });

  it("keeps a reader verified while loading, and the stored ones around it", async () => {
    await seedStorage([hubB]);
    const release = holdNextRead();
    const hydrated = useReaderMemory.persist.rehydrate();
    store().remember(hubA);
    release();
    await hydrated;
    await settle();
    expect(Object.keys(store().readers).sort()).toEqual([hubA.origin, hubB.origin]);
    expect((await stored())?.sort()).toEqual([hubA.origin, hubB.origin]);
  });

  it("prefers the account that signed in while loading over the stored one", async () => {
    await seedStorage([{ ...hubA, id: "u-old" }]);
    const release = holdNextRead();
    const hydrated = useReaderMemory.persist.rehydrate();
    store().remember({ ...hubA, id: "u-new" });
    release();
    await hydrated;
    await settle();
    expect(store().readers[hubA.origin]?.id).toBe("u-new");
  });

  it("restores the readers of an app that is simply restarting", async () => {
    await seedStorage([hubA]);
    await useReaderMemory.persist.rehydrate();
    expect(Object.keys(store().readers)).toEqual([hubA.origin]);
  });
});
