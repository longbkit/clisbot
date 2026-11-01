import type { PickerKeyboardInput } from "./use-picker-keyboard.types";

/** Touch platforms have no picker shortcuts; web owns them (`use-picker-keyboard.web.ts`). */
export function usePickerKeyboard(_input: PickerKeyboardInput): void {}
