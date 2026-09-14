import { View } from "react-native";

// Web tests never fabricate native views; a spec component renders as a plain
// view so the tree stays inspectable.
export default function codegenNativeComponent(): typeof View {
  return View;
}
