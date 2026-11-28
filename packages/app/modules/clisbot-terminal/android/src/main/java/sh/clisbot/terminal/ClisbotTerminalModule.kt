package sh.clisbot.terminal

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ClisbotTerminalModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ClisbotTerminal")

    OnCreate { TerminalInputKeyboard.install() }

    View(ClisbotTerminalView::class) {
      Events("onCellMetrics")

      Prop("frame") { view: ClisbotTerminalView, frame: TerminalFrameRecord -> view.setFrame(frame) }
      Prop("theme") { view: ClisbotTerminalView, theme: TerminalThemeRecord -> view.setTheme(theme) }
      Prop("fontFamily") { view: ClisbotTerminalView, family: String -> view.setFontFamily(family) }
      Prop("fontSize") { view: ClisbotTerminalView, size: Double -> view.setFontSize(size) }
      Prop("customGlyphs") { view: ClisbotTerminalView, glyphs: List<TerminalCustomGlyphRecord> ->
        view.setCustomGlyphs(glyphs)
      }

      OnViewDidUpdateProps { view: ClisbotTerminalView -> view.commit() }
    }
  }
}
