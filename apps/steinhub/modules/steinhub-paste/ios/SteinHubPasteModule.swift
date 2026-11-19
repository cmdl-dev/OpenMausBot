import ExpoModulesCore
import ObjectiveC
import UIKit
import UniformTypeIdentifiers

/// React Native 0.88's text views (RCTUITextView, RCTUITextField) paste text only, so an image copied to the clipboard,
/// or offered by the keyboard's clipboard suggestion, never arrives. While JavaScript says the focused field takes
/// images, an image pasted into it is written to a temporary file and handed to JavaScript; text pastes as before.
public class SteinHubPasteModule: Module {
  static weak var current: SteinHubPasteModule?
  private static var installed = false
  /// Only the field that asked: a password field elsewhere keeps pasting text.
  static var accepting = false

  static var takesImages: Bool { accepting && current != nil }

  public func definition() -> ModuleDefinition {
    Name("SteinHubPaste")
    Events("onPasteImages")

    Function("setAcceptsImages") { (on: Bool) in
      SteinHubPasteModule.accepting = on
    }

    OnCreate {
      SteinHubPasteModule.current = self
      DispatchQueue.main.async { SteinHubPasteModule.install() }
    }
  }

  fileprivate func send(_ images: [[String: Any]]) {
    guard !images.isEmpty else { return }
    sendEvent("onPasteImages", ["images": images])
  }

  static func install() {
    guard !installed else { return }
    installed = true
    for name in ["RCTUITextView", "RCTUITextField"] {
      guard let cls = NSClassFromString(name) else { continue }
      hookCanPerformAction(cls)
      hookPaste(cls)
      hookCanPasteItemProviders(cls)
      hookPasteItemProviders(cls)
    }
  }

  // MARK: - Reading the clipboard

  /// Called from a paste the person made, so iOS reads the clipboard without asking.
  static func pasteboardImages() -> [UIImage] {
    let pasteboard = UIPasteboard.general
    guard pasteboard.hasImages else { return [] }
    return pasteboard.images ?? []
  }

  static func save(_ images: [UIImage]) -> [[String: Any]] {
    images.compactMap { image in
      guard let data = image.jpegData(compressionQuality: 0.85) else { return nil }
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("pasted-\(UUID().uuidString).jpg")
      do {
        try data.write(to: url)
      } catch {
        return nil
      }
      return ["uri": url.absoluteString, "width": image.size.width * image.scale, "height": image.size.height * image.scale]
    }
  }

  static func deliver(_ images: [UIImage]) {
    let saved = save(images)
    DispatchQueue.main.async { current?.send(saved) }
  }

  // MARK: - Hooks

  /// Replaces `selector` on `cls`, adding an override when the method is only inherited, so the superclass is untouched.
  private static func replace(_ cls: AnyClass, _ selector: Selector, with block: Any) -> IMP? {
    guard let method = class_getInstanceMethod(cls, selector) else { return nil }
    let original = method_getImplementation(method)
    let replacement = imp_implementationWithBlock(block)
    if !class_addMethod(cls, selector, replacement, method_getTypeEncoding(method)) {
      method_setImplementation(method, replacement)
    }
    return original
  }

  private static func hookCanPerformAction(_ cls: AnyClass) {
    let selector = #selector(UIResponder.canPerformAction(_:withSender:))
    typealias Fn = @convention(c) (AnyObject, Selector, Selector, Any?) -> Bool
    var original: Fn?
    let block: @convention(block) (AnyObject, Selector, Any?) -> Bool = { view, action, sender in
      if takesImages, action == #selector(UIResponderStandardEditActions.paste(_:)), UIPasteboard.general.hasImages,
         (view as? UIResponder)?.isFirstResponder == true {
        return true
      }
      return original?(view, selector, action, sender) ?? false
    }
    if let imp = replace(cls, selector, with: block) { original = unsafeBitCast(imp, to: Fn.self) }
  }

  private static func hookPaste(_ cls: AnyClass) {
    let selector = #selector(UIResponderStandardEditActions.paste(_:))
    typealias Fn = @convention(c) (AnyObject, Selector, Any?) -> Void
    var original: Fn?
    let block: @convention(block) (AnyObject, Any?) -> Void = { view, sender in
      let images = takesImages ? pasteboardImages() : []
      if !images.isEmpty {
        deliver(images)
        return
      }
      original?(view, selector, sender)
    }
    if let imp = replace(cls, selector, with: block) { original = unsafeBitCast(imp, to: Fn.self) }
  }

  private static func providesImage(_ providers: [NSItemProvider]) -> Bool {
    providers.contains { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) && !$0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }
  }

  private static func hookCanPasteItemProviders(_ cls: AnyClass) {
    let selector = NSSelectorFromString("canPasteItemProviders:")
    typealias Fn = @convention(c) (AnyObject, Selector, [NSItemProvider]) -> Bool
    var original: Fn?
    let block: @convention(block) (AnyObject, [NSItemProvider]) -> Bool = { view, providers in
      if takesImages, providesImage(providers) { return true }
      return original?(view, selector, providers) ?? false
    }
    if let imp = replace(cls, selector, with: block) { original = unsafeBitCast(imp, to: Fn.self) }
  }

  private static func hookPasteItemProviders(_ cls: AnyClass) {
    let selector = NSSelectorFromString("pasteItemProviders:")
    typealias Fn = @convention(c) (AnyObject, Selector, [NSItemProvider]) -> Void
    var original: Fn?
    let block: @convention(block) (AnyObject, [NSItemProvider]) -> Void = { view, providers in
      guard takesImages, providesImage(providers) else {
        original?(view, selector, providers)
        return
      }
      let group = DispatchGroup()
      var images: [UIImage] = []
      let lock = NSLock()
      for provider in providers where provider.canLoadObject(ofClass: UIImage.self) {
        group.enter()
        provider.loadObject(ofClass: UIImage.self) { object, _ in
          if let image = object as? UIImage {
            lock.lock()
            images.append(image)
            lock.unlock()
          }
          group.leave()
        }
      }
      group.notify(queue: .global(qos: .userInitiated)) { deliver(images) }
    }
    if let imp = replace(cls, selector, with: block) { original = unsafeBitCast(imp, to: Fn.self) }
  }
}
