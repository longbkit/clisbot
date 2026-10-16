import { requireOptionalNativeModule } from "expo-modules-core";
import { traceInstant } from "@/performance/native-trace";
import { createReceiveCodecSelector, type NativeReceiveModule } from "./receive-codec-adapter";

function optionalModule(): NativeReceiveModule | null {
  try {
    return requireOptionalNativeModule<NativeReceiveModule>("ClisbotReceiveCodec");
  } catch {
    return null;
  }
}
const select = createReceiveCodecSelector(optionalModule());
let lastSelection: boolean | undefined;
export async function selectReceiveCodec() {
  const codec = await select();
  if (lastSelection !== !!codec) {
    lastSelection = !!codec;
    traceInstant("clisbot.codec.selected", { native: String(!!codec) });
  }
  return codec;
}
