import ExpoModulesCore

public class ClisbotTerminalModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ClisbotTerminal")

    View(ClisbotTerminalView.self) {
      Events("onCellMetrics")

      Prop("frame") { (view: ClisbotTerminalView, frame: TerminalFrameRecord) in view.setFrame(frame) }
      Prop("theme") { (view: ClisbotTerminalView, theme: TerminalThemeRecord) in view.setTheme(theme) }
      Prop("fontFamily") { (view: ClisbotTerminalView, family: String) in view.setFontFamily(family) }
      Prop("fontSize") { (view: ClisbotTerminalView, size: Double) in view.setFontSize(size) }
      Prop("customGlyphs") { (view: ClisbotTerminalView, glyphs: [TerminalCustomGlyphRecord]) in
        view.setCustomGlyphs(glyphs)
      }

      OnViewDidUpdateProps { (view: ClisbotTerminalView) in view.commit() }
    }
  }
}
