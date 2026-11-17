Pod::Spec.new do |s|
  s.name           = 'SteinHubPaste'
  s.version        = '0.1.0'
  s.summary        = 'Images pasted into SteinHub text fields'
  s.description    = 'Lets a React Native text field take an image from Paste or a keyboard suggestion and hands it to JavaScript.'
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
