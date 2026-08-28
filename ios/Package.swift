// swift-tools-version: 6.0
import PackageDescription

/// The iOS client is a Swift package rather than an Xcode project so the
/// modules build and test from the command line, which is what makes them
/// verifiable in CI. The app target that hosts them arrives in T2.3.
let package = Package(
    name: "Klinik",
    // Turkish is the base language: the clinic's own staff use the app all day,
    // and patients arrive in many languages that all fall back to this one.
    defaultLocalization: "tr",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "KlinikDesign", targets: ["KlinikDesign"]),
        .library(name: "KlinikCore", targets: ["KlinikCore"]),
        .library(name: "KlinikAPI", targets: ["KlinikAPI"]),
    ],
    targets: [
        // Generated from design/tokens.json, shared with Android (spec 3.2).
        .target(name: "KlinikDesign"),

        // Session state, secure storage, localisation and the errors the UI
        // branches on.
        .target(name: "KlinikCore", resources: [.process("Resources")]),

        // Networking against the published OpenAPI contract.
        .target(name: "KlinikAPI", dependencies: ["KlinikCore"]),

        .testTarget(name: "KlinikDesignTests", dependencies: ["KlinikDesign"]),
        .testTarget(name: "KlinikCoreTests", dependencies: ["KlinikCore"]),
        .testTarget(name: "KlinikAPITests", dependencies: ["KlinikAPI", "KlinikCore"]),
    ]
)
