import ExpoModulesCore
import UIKit
import UIKit.UIGestureRecognizerSubclass

/// Shows the system edit menu (the Copy / Share callout iOS draws over text) where the finger last touched,
/// and resolves with the index of the item chosen, or nil when it is dismissed without a choice.
/// The finger is read natively: a native text view takes the touch before React Native reports it.
public class SteinHubMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SteinHubMenu")

    OnCreate {
      DispatchQueue.main.async { TouchRecorder.watchWindows() }
    }

    AsyncFunction("show") { (x: Double, y: Double, items: [MenuItem], promise: Promise) in
      guard !items.isEmpty, let root = Self.rootView() else {
        promise.resolve(nil)
        return
      }
      let point = TouchRecorder.recent() ?? CGPoint(x: x, y: y)
      EditMenu.present(in: root, at: point, items: items) { promise.resolve($0) }
    }.runOnQueue(.main)
  }

  private static func rootView() -> UIView? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)?
      .rootViewController?
      .view
  }
}

struct MenuItem: Record {
  @Field var title: String = ""
  /// An SF Symbol name.
  @Field var icon: String?
}

private final class EditMenu: NSObject, UIEditMenuInteractionDelegate {
  private static var shown: EditMenu?

  private lazy var interaction = UIEditMenuInteraction(delegate: self)
  /// The tapped line: the callout points at it and sits clear of it.
  private let anchor: UIView
  private let items: [MenuItem]
  private var finish: ((Int?) -> Void)?
  private var chosen: Int?

  private static let lineHeight: CGFloat = 24

  static func present(in root: UIView, at point: CGPoint, items: [MenuItem], finish: @escaping (Int?) -> Void) {
    shown?.interaction.dismissMenu()
    shown?.close()
    let local = root.convert(point, from: nil)
    let anchor = UIView(frame: CGRect(x: local.x, y: local.y - lineHeight / 2, width: 1, height: lineHeight))
    anchor.isUserInteractionEnabled = false
    root.addSubview(anchor)
    let menu = EditMenu(anchor: anchor, items: items, finish: finish)
    shown = menu
    anchor.addInteraction(menu.interaction)
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
    let configuration = UIEditMenuConfiguration(identifier: nil, sourcePoint: CGPoint(x: 0, y: lineHeight / 2))
    configuration.preferredArrowDirection = .down
    menu.interaction.presentEditMenu(with: configuration)
  }

  private init(anchor: UIView, items: [MenuItem], finish: @escaping (Int?) -> Void) {
    self.anchor = anchor
    self.items = items
    self.finish = finish
    super.init()
  }

  func editMenuInteraction(
    _ interaction: UIEditMenuInteraction,
    menuFor configuration: UIEditMenuConfiguration,
    suggestedActions: [UIMenuElement]
  ) -> UIMenu? {
    UIMenu(children: items.enumerated().map { index, item in
      UIAction(title: item.title, image: item.icon.flatMap { UIImage(systemName: $0) }) { [weak self] _ in
        self?.chosen = index
      }
    })
  }

  func editMenuInteraction(_ interaction: UIEditMenuInteraction, targetRectFor configuration: UIEditMenuConfiguration) -> CGRect {
    anchor.bounds
  }

  func editMenuInteraction(
    _ interaction: UIEditMenuInteraction,
    willDismissMenuFor configuration: UIEditMenuConfiguration,
    animator: UIEditMenuInteractionAnimating
  ) {
    animator.addCompletion { [weak self] in self?.close() }
  }

  private func close() {
    anchor.removeInteraction(interaction)
    anchor.removeFromSuperview()
    finish?(chosen)
    finish = nil
    if Self.shown === self { Self.shown = nil }
  }
}

/// Notes where each touch begins, in window coordinates, and never recognizes, so every other gesture runs as before.
private final class TouchRecorder: UIGestureRecognizer, UIGestureRecognizerDelegate {
  private static var last: (point: CGPoint, at: Date)?
  private static var observer: NSObjectProtocol?

  /// A tap that opens the menu reaches JavaScript well within this.
  private static let freshFor: TimeInterval = 2

  static func recent() -> CGPoint? {
    guard let last, Date().timeIntervalSince(last.at) < freshFor else { return nil }
    return last.point
  }

  static func watchWindows() {
    guard observer == nil else { return }
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .forEach(install)
    observer = NotificationCenter.default.addObserver(forName: UIWindow.didBecomeKeyNotification, object: nil, queue: .main) { note in
      (note.object as? UIWindow).map(install)
    }
  }

  private static func install(on window: UIWindow) {
    guard !(window.gestureRecognizers ?? []).contains(where: { $0 is TouchRecorder }) else { return }
    window.addGestureRecognizer(TouchRecorder())
  }

  init() {
    super.init(target: nil, action: nil)
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
    delegate = self
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    if let touch = touches.first { Self.last = (touch.location(in: nil), Date()) }
    state = .failed
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    true
  }
}
