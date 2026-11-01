export interface PickerKeyboardInput {
  enabled: boolean;
  rowCount: number;
  highlight: number;
  setHighlight: (index: number) => void;
  onPickIndex: (index: number) => void;
}
