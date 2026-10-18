/** Long-press release is never a second primary activation. */
export class SendPressGate {
  private menuGesture = false;
  begin() {
    this.menuGesture = false;
  }
  openMenu() {
    this.menuGesture = true;
  }
  takePrimary(): boolean {
    const allowed = !this.menuGesture;
    this.menuGesture = false;
    return allowed;
  }
}
