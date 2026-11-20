Pod::Spec.new do |s|
  s.name           = 'SteinHubMenu'
  s.version        = '0.1.0'
  s.summary        = 'The menu a tapped message shows'
  s.description    = 'Shows the system edit menu at a point and hands the chosen item to JavaScript.'
  s.license        = 'Apache-2.0'
  s.author         = 'OpenMausBot'
  s.homepage       = 'https://github.com/cmdl-dev/OpenMausBot'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
