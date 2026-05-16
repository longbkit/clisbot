export type OrderedIngressControls = {
  markAccepted: () => void;
};

export class OrderedIngressDispatcher<TItem> {
  private readonly acceptedByKey = new Map<string, Promise<void>>();

  constructor(
    private readonly getKey: (item: TItem) => string | undefined,
    private readonly handleItem: (
      item: TItem,
      controls: OrderedIngressControls,
    ) => Promise<void>,
    private readonly onUnhandledError?: (error: unknown, item: TItem) => void,
  ) {}

  dispatch(items: TItem[]) {
    return items.map((item) => this.dispatchOne(item));
  }

  private dispatchOne(item: TItem) {
    const key = this.getKey(item);
    if (!key) {
      return this.runItem(item, Promise.resolve());
    }

    const previousAccepted = this.acceptedByKey.get(key) ?? Promise.resolve();
    const accepted = createManualPromise();
    this.acceptedByKey.set(key, accepted.promise);
    accepted.promise.finally(() => {
      if (this.acceptedByKey.get(key) === accepted.promise) {
        this.acceptedByKey.delete(key);
      }
    });

    return this.runItem(item, previousAccepted, accepted.resolve);
  }

  private async runItem(
    item: TItem,
    waitForPreviousAccepted: Promise<void>,
    markAccepted: () => void = () => undefined,
  ) {
    let accepted = false;
    const markAcceptedOnce = () => {
      if (accepted) {
        return;
      }
      accepted = true;
      markAccepted();
    };

    try {
      await waitForPreviousAccepted;
      await this.handleItem(item, {
        markAccepted: markAcceptedOnce,
      });
    } catch (error) {
      this.onUnhandledError?.(error, item);
    } finally {
      markAcceptedOnce();
    }
  }
}

function createManualPromise() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
