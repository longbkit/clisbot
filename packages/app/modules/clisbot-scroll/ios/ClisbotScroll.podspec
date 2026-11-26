Pod::Spec.new do |s|
  s.name           = 'ClisbotScroll'
  s.version        = '0.1.0'
  s.summary        = 'Scroll view corrections for Clisbot'
  s.description    = 'Scroll view corrections for Clisbot'
  s.license        = 'Apache-2.0'
  s.author         = 'Clisbot'
  s.homepage       = 'https://clisbot.com'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :path => '.' }
  s.static_framework = true

  s.source_files = "**/*.{h,mm}"

  install_modules_dependencies(s)
end
